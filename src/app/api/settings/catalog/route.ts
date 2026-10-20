import { withAuth } from "@/lib/api";
import { catalogDisabledResponse, catalogEnabled } from "@/server/catalog/flag";
import { CatalogError, getCatalogSnapshot, syncCatalog } from "@/server/catalog/service";
import { catalogProductPricing } from "@/server/catalog/context";
import { LOCAL_DROPI_PRODUCT_ID_ATTRIBUTE, dropiProductIdFromAttributes } from "@/server/dropi/product-mapping";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  if (!catalogEnabled()) return catalogDisabledResponse();
  const snapshot = await getCatalogSnapshot(session.organizationId);
  return Response.json({
    catalog: snapshot ? {
      catalogId: snapshot.catalogId,
      name: snapshot.catalogName,
      syncedAt: snapshot.syncedAt.toISOString(),
      productCount: snapshot.products.length,
      inStockCount: snapshot.products.filter((p) => p.availability === "in stock").length,
    } : null,
    ...(snapshot && new URL(req.url).searchParams.get("products") === "1" ? {
      products: snapshot.products.map(({ retailerId, name, description, availability, price, currency, brand, imageUrl, url, attributes }) => {
        const pricing = catalogProductPricing({ price, currency, attributes });
        return {
        retailerId, name, description, availability, price, salePrice: pricing.salePrice, isOnSale: pricing.isOnSale, currency, brand, imageUrl, url,
        dropiProductId: dropiProductIdFromAttributes(attributes),
        attributes: Object.fromEntries(Object.entries(attributes as Record<string, unknown>).filter(([key]) => key !== LOCAL_DROPI_PRODUCT_ID_ATTRIBUTE)),
        };
      }),
    } : {}),
  });
});

export const POST = withAuth(async (session) => {
  if (!catalogEnabled()) return catalogDisabledResponse();
  try {
    const snapshot = await syncCatalog(session.organizationId, { force: true });
    return Response.json({
      catalog: {
        catalogId: snapshot.catalogId,
        name: snapshot.catalogName,
        syncedAt: snapshot.syncedAt.toISOString(),
        productCount: snapshot.products.length,
        inStockCount: snapshot.products.filter((p) => p.availability === "in stock").length,
      },
    });
  } catch (err) {
    if (err instanceof CatalogError) {
      const status = err.code === "not_connected" ? 409 : err.code === "meta_unavailable" ? 503 : 422;
      return Response.json({ error: { code: err.code, message: err.message } }, { status });
    }
    throw err;
  }
});
