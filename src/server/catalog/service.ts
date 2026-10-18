import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import { getCredentialsByOrg, markReconnectRequired } from "@/server/whatsapp/credentials";
import { scoped } from "@/lib/db/tenant";

const FRESH_MS = 10 * 60_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 200;
const PRODUCT_FIELDS = [
  "retailer_id", "name", "description", "availability", "price", "currency",
  "brand", "image_url", "url", "category", "condition",
  "manufacturer_part_number", "manufacturer_info", "gtin", "color", "material",
  "size", "pattern", "gender", "age_group", "product_type", "origin_country",
  "sale_price", "sale_price_start_date", "sale_price_end_date", "inventory",
  "quantity_to_sell_on_facebook", "expiration_date", "custom_data",
  "custom_label_0", "custom_label_1", "custom_label_2", "custom_label_3",
  "custom_label_4", "custom_number_0", "custom_number_1", "custom_number_2",
  "custom_number_3", "custom_number_4", "retailer_product_group_id", "status",
  "tags", "visibility", "shipping_weight_value", "shipping_weight_unit",
  "short_description", "rich_text_description", "additional_image_urls",
  "additional_variant_attributes", "videos", "wa_compliance_category", "vendor_id",
].join(",");

type MetaProduct = {
  id?: string;
  retailer_id?: string;
  name?: string;
  description?: string;
  availability?: string;
  price?: string | number;
  currency?: string;
  brand?: string;
  image_url?: string;
  url?: string;
  [key: string]: unknown;
};

type Page<T> = { data?: T[]; paging?: { cursors?: { after?: string }; next?: string } };

const inFlight = new Map<string, Promise<CatalogSnapshot>>();

export type CatalogSnapshot = {
  catalogId: string;
  catalogName: string | null;
  syncedAt: Date;
  products: (typeof schema.metaCatalogProduct.$inferSelect)[];
};

export class CatalogError extends Error {
  constructor(message: string, readonly code: "not_connected" | "no_catalog" | "meta_unavailable" | "meta_error") {
    super(message);
    this.name = "CatalogError";
  }
}

function normalizeProduct(organizationId: string, catalogId: string, product: MetaProduct) {
  if (!product.retailer_id?.trim() || !product.name?.trim()) return null;
  const known = new Set([
    "id", "retailer_id", "name", "description", "availability", "price", "currency",
    "brand", "image_url", "url",
  ]);
  const attributes = Object.fromEntries(Object.entries(product).filter(([key]) => !known.has(key)));
  return {
    id: newId("metaCatalogProduct"), organizationId, catalogId,
    retailerId: product.retailer_id.trim(), name: product.name.trim(),
    description: typeof product.description === "string" ? product.description : null,
    availability: typeof product.availability === "string" ? product.availability : null,
    price: typeof product.price === "string" || typeof product.price === "number" ? String(product.price) : null,
    currency: typeof product.currency === "string" ? product.currency : null,
    brand: typeof product.brand === "string" ? product.brand : null,
    imageUrl: typeof product.image_url === "string" ? product.image_url : null,
    url: typeof product.url === "string" ? product.url : null,
    attributes,
  };
}

async function readAll<T>(path: string, token: string): Promise<T[]> {
  const all: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ fields: path.includes("/products") ? PRODUCT_FIELDS : "id,name", limit: String(PAGE_SIZE) });
    if (after) query.set("after", after);
    const result = await graphRequest<Page<T>>(`${path}?${query}`, { token });
    all.push(...(result.data ?? []));
    after = result.paging?.cursors?.after;
    if (!result.paging?.next) return all;
    if (!after) throw new CatalogError("Meta indicó más páginas sin cursor; el snapshot no fue reemplazado", "meta_error");
  }
  throw new CatalogError("El catálogo supera el límite de sincronización", "meta_error");
}

async function fetchSnapshot(organizationId: string): Promise<CatalogSnapshot> {
  const credentials = await getCredentialsByOrg(organizationId);
  if (!credentials || credentials.status !== "connected") {
    throw new CatalogError("Conecta o reconecta WhatsApp antes de sincronizar el catálogo", "not_connected");
  }
  try {
    const catalogs = await readAll<{ id?: string; name?: string }>(`${credentials.wabaId}/product_catalogs`, credentials.token);
    const linkedCatalogs = catalogs.filter((item) => typeof item.id === "string");
    if (linkedCatalogs.length === 0) throw new CatalogError("La WABA no tiene un catálogo de productos vinculado", "no_catalog");
    if (linkedCatalogs.length > 1) throw new CatalogError("La WABA tiene varios catálogos vinculados; no se eligió uno automáticamente", "no_catalog");
    const catalog = linkedCatalogs[0]!;
    const catalogId = catalog.id!;
    const products = await readAll<MetaProduct>(`${catalogId}/products`, credentials.token);
    const rows = products.map((product) => normalizeProduct(organizationId, catalogId, product)).filter((row) => row !== null);
    const db = getDb();
    await db.transaction(async (tx) => {
      const existing = await tx.select().from(schema.metaCatalog)
        .where(scoped(schema.metaCatalog.organizationId, organizationId)).limit(1);
      const catalogRow = existing[0];
      if (catalogRow) {
        await tx.update(schema.metaCatalog).set({ catalogId, catalogName: catalog.name ?? null, syncedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(schema.metaCatalog.organizationId, organizationId), eq(schema.metaCatalog.id, catalogRow.id)));
      } else {
        await tx.insert(schema.metaCatalog).values({ id: newId("metaCatalog"), organizationId, catalogId, catalogName: catalog.name ?? null, syncedAt: new Date() });
      }
      await tx.delete(schema.metaCatalogProduct).where(scoped(schema.metaCatalogProduct.organizationId, organizationId));
      if (rows.length) await tx.insert(schema.metaCatalogProduct).values(rows);
    });
    return await getCatalogSnapshot(organizationId) as CatalogSnapshot;
  } catch (err) {
    if (err instanceof MetaApiError && err.isAuthError) await markReconnectRequired(organizationId);
    if (err instanceof CatalogError) throw err;
    if (err instanceof MetaApiError && (err.status === 0 || err.status >= 500)) {
      throw new CatalogError("Meta no está disponible ahora; no se usó una copia antigua del catálogo", "meta_unavailable");
    }
    if (err instanceof MetaApiError) throw new CatalogError(err.message, "meta_error");
    throw err;
  }
}

export async function getCatalogSnapshot(organizationId: string): Promise<CatalogSnapshot | null> {
  const db = getDb();
  const rows = await db.select().from(schema.metaCatalog)
    .where(scoped(schema.metaCatalog.organizationId, organizationId)).limit(1);
  const catalog = rows[0];
  if (!catalog?.syncedAt) return null;
  const products = await db.select().from(schema.metaCatalogProduct)
    .where(scoped(schema.metaCatalogProduct.organizationId, organizationId, eq(schema.metaCatalogProduct.catalogId, catalog.catalogId)));
  return { catalogId: catalog.catalogId, catalogName: catalog.catalogName, syncedAt: catalog.syncedAt, products };
}

export async function syncCatalog(organizationId: string): Promise<CatalogSnapshot> {
  const current = inFlight.get(organizationId);
  if (current) return current;
  const pending = fetchSnapshot(organizationId).finally(() => inFlight.delete(organizationId));
  inFlight.set(organizationId, pending);
  return pending;
}

export async function getFreshCatalog(organizationId: string): Promise<CatalogSnapshot | null> {
  try {
    const current = await getCatalogSnapshot(organizationId);
    if (isCatalogFresh(current)) return current;
    return await syncCatalog(organizationId);
  } catch (err) {
    console.warn(`[catalogo] no se pudo refrescar para ${organizationId}: ${err instanceof Error ? err.message : "error"}`);
    return null;
  }
}

export function isCatalogFresh(snapshot: CatalogSnapshot | null): snapshot is CatalogSnapshot {
  return Boolean(snapshot && Date.now() - snapshot.syncedAt.getTime() < FRESH_MS);
}

/** La allowlist final es del servidor: jamás se confía en los IDs del LLM. */
export function resolveInStockProducts(
  snapshot: CatalogSnapshot,
  retailerIds: string[]
): (typeof schema.metaCatalogProduct.$inferSelect)[] | null {
  const ids = [...new Set(retailerIds)];
  if (ids.length === 0 || ids.length > 30) return null;
  const products = ids.map((id) => snapshot.products.find(
    (product) => product.retailerId === id && product.availability === "in stock"
  ));
  return products.some((product) => !product) ? null : products as (typeof schema.metaCatalogProduct.$inferSelect)[];
}

export function catalogFreshnessMs(): number { return FRESH_MS; }
