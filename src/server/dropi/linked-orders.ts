import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getDropiConnection } from "./credentials";
import { phoneFromFicha } from "@/server/bot/ficha";
import { callDropiTool, listDropiTools } from "./mcp-client";
import { dropiProductIdFromAttributes } from "./product-mapping";

export class DropiLinkError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export type DropiLinkedOrder = {
  orderId: string;
  status: string | null;
  trackingCode: string | null;
  createdAt: string | null;
  carrier: string | null;
  total: string | null;
  currency: string | null;
  items: { name: string; quantity: string | null; productId?: string | null }[];
  updatedAt: string;
  source: "linked" | "vocero";
};

function normalizedKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findValue(value: unknown, keys: string[]): unknown {
  const wanted = new Set(keys.map(normalizedKey));
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findValue(entry, keys);
      if (found !== undefined && found !== null && found !== "") return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(record)) {
    if (wanted.has(normalizedKey(key)) && candidate !== undefined && candidate !== null && candidate !== "") return candidate;
  }
  for (const candidate of Object.values(record)) {
    const found = findValue(candidate, keys);
    if (found !== undefined && found !== null && found !== "") return found;
  }
  return undefined;
}

function findArray(value: unknown, keys: string[]): unknown[] {
  const wanted = new Set(keys.map(normalizedKey));
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findArray(entry, keys);
      if (found.length) return found;
    }
    return [];
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(record)) {
    if (wanted.has(normalizedKey(key)) && Array.isArray(candidate)) return candidate;
  }
  for (const candidate of Object.values(record)) {
    const found = findArray(candidate, keys);
    if (found.length) return found;
  }
  return [];
}

function textValue(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
}

function normalizedPhone(value: string | null | undefined) {
  let digits = (value ?? "").replace(/\D/g, "");
  if (digits.startsWith("57") && digits.length === 12) digits = digits.slice(2);
  return digits;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const unquoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ? trimmed.slice(1, -1)
    : trimmed;
  if (/^-?\d+(?:\.\d+)?$/.test(unquoted)) return Number(unquoted);
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  if (unquoted === "null") return null;
  return unquoted;
}

function splitDelimitedRow(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function parseDropiText(text: string): unknown | undefined {
  const root: Record<string, unknown> = {};
  let activeObject: Record<string, unknown> | null = null;
  let activeArray: unknown[] | null = null;
  let itemHeaders: string[] | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tableHeader = line.match(/^\s*([\w-]+)\[\d+\]\{([^}]+)\}:\s*$/);
    if (tableHeader) {
      const key = tableHeader[1];
      const columns = tableHeader[2];
      if (!key || !columns) continue;
      itemHeaders = columns.split(",").map((part) => part.trim());
      activeArray = [];
      root[key] = activeArray;
      activeObject = null;
      continue;
    }

    const field = line.match(/^(\s*)([\w-]+):(?:\s*(.*))?$/);
    if (field) {
      const indent = field[1]?.length ?? 0;
      const key = field[2];
      if (!key) continue;
      const value = field[3] ?? "";
      if (indent === 0) {
        itemHeaders = null;
        activeArray = null;
        if (value.trim()) {
          root[key] = parseScalar(value);
          activeObject = null;
        } else {
          const nested: Record<string, unknown> = {};
          root[key] = nested;
          activeObject = nested;
        }
      } else if (activeObject) {
        activeObject[key] = parseScalar(value);
      }
      continue;
    }

    if (itemHeaders && activeArray && /^\s+/.test(line)) {
      const values = splitDelimitedRow(line.trim());
      if (values.length > itemHeaders.length && itemHeaders.length >= 3) {
        const trailingColumns = itemHeaders.length - 2;
        values.splice(1, values.length - trailingColumns - 1, values.slice(1, values.length - trailingColumns).join(","));
      }
      const item = Object.fromEntries(itemHeaders.map((key, index) => [key, parseScalar(values[index] ?? "")]));
      activeArray.push(item);
    }
  }

  const keys = new Set(Object.keys(root).map(normalizedKey));
  return keys.has("orderid") || keys.has("status") || keys.has("customer") || keys.has("items") || keys.has("products")
    ? root
    : undefined;
}

function decodeOrder(result: {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}): unknown {
  if (result.isError) throw new DropiLinkError("Dropi no pudo encontrar o consultar ese pedido.", "provider_error");

  const parseJson = (candidate: string): unknown | undefined => {
    const trimmed = candidate.trim();
    const candidates = [trimmed, trimmed.match(/[\[{][\s\S]*[\]}]/)?.[0]];
    for (const value of candidates) {
      if (!value) continue;
      try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === "string") {
          try { return JSON.parse(parsed) as unknown; } catch { /* try another representation */ }
        } else {
          return parsed;
        }
      } catch { /* try the next representation */ }
    }
    return undefined;
  };

  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    if (typeof result.structuredContent !== "string") return result.structuredContent;
    const parsed = parseJson(result.structuredContent);
    if (parsed !== undefined) return parsed;
    const structured = parseDropiText(result.structuredContent);
    if (structured !== undefined) return structured;
  }

  const text = (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .filter(Boolean);
  for (const part of text) {
    const parsed = parseJson(part);
    if (parsed !== undefined) return parsed;
    const structured = parseDropiText(part);
    if (structured !== undefined) return structured;
  }
  const combined = text.join("\n");
  const parsedCombined = parseJson(combined);
  if (parsedCombined !== undefined) return parsedCombined;
  const structuredCombined = parseDropiText(combined);
  if (structuredCombined !== undefined) return structuredCombined;
  throw new DropiLinkError("Dropi devolvió una respuesta de pedido que no se pudo interpretar.", "invalid_response");
}
function carrierFromOrder(data: unknown): string | null {
  const carrier = findValue(data, [
    "shipping_company", "shipping_carrier", "carrier_name", "carrier",
    "distribution_company_name", "logistics_company", "logistic_company",
    "courier", "transportadora",
  ]);
  return textValue(carrier)
    ?? textValue(findValue(carrier, ["name", "company_name", "display_name", "title"]));
}

function dateValue(data: unknown, keys: string[]): string | null {
  const value = findValue(data, keys);
  const text = textValue(value);
  if (!text) return null;
  const numeric = Number(text);
  const isEpoch = Number.isFinite(numeric) && /^\d{10,13}$/.test(text);
  // Dropi's naive timestamps represent Colombia local time (UTC-5), not UTC.
  // Preserve explicit timezone offsets and only add Colombia's offset when absent.
  const hasTimezone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text);
  const isLocalDate = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const isLocalDateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text);
  const normalizedText = !hasTimezone && isLocalDate
    ? `${text}T00:00:00-05:00`
    : !hasTimezone && isLocalDateTime
      ? `${text.replace(" ", "T")}-05:00`
      : text;
  const date = new Date(isEpoch
    ? (text.length === 10 ? numeric * 1000 : numeric)
    : normalizedText);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function summaryFromOrder(orderId: string, data: unknown, source: DropiLinkedOrder["source"]): DropiLinkedOrder {
  const rawItems = findArray(data, ["products", "items", "order_items", "details"]);
  const items = rawItems.slice(0, 20).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const productId = textValue(findValue(entry, ["product_retailer_id", "product_id", "productId", "id", "sku"]));
    const name = textValue(findValue(entry, ["product_name", "name", "title", "product"]));
    const quantity = textValue(findValue(entry, ["quantity", "qty"]));
    return name || productId ? [{ name: name ?? "Producto", quantity, productId }] : [];
  });
  const createdAt = dateValue(data, ["created_at", "createdAt", "creation_date", "creationDate", "order_date", "orderDate", "date_created"]);
  return {
    orderId,
    status: textValue(findValue(data, ["status", "order_status", "orderStatus"])),
    trackingCode: textValue(findValue(data, ["tracking_code", "trackingCode", "tracking_number", "guide"])),
    createdAt,
    carrier: carrierFromOrder(data),
    total: textValue(findValue(data, ["total", "total_amount", "grand_total", "order_total"])),
    currency: textValue(findValue(data, ["currency", "currency_code"])),
    items,
    updatedAt: dateValue(data, ["updated_at", "updatedAt"]) ?? createdAt ?? new Date().toISOString(),
    source,
  };
}

function assertPhoneOwnership(contactPhone: string | null, orderData: unknown) {
  const customer = findValue(orderData, ["customer", "client", "recipient", "buyer"]);
  const orderPhone = textValue(findValue(customer ?? orderData, [
    "customer_phone", "customerPhone", "phone_number", "phoneNumber", "cellphone", "mobile", "phone", "telephone",
  ]));
  const expected = normalizedPhone(contactPhone);
  const actual = normalizedPhone(orderPhone);
  if (!expected || !actual || expected !== actual) {
    throw new DropiLinkError("No se pudo verificar que ese pedido pertenezca a este contacto: el teléfono no coincide o Dropi no lo devolvió.", "owner_mismatch");
  }
}

export async function listDropiOrdersForContact(organizationId: string, contactId: string): Promise<{ connected: boolean; orders: DropiLinkedOrder[] }> {
  const connection = await getDropiConnection(organizationId);
  const db = getDb();
  const [linked, submissions] = await Promise.all([
    db.select().from(schema.dropiOrderLink).where(scoped(
      schema.dropiOrderLink.organizationId, organizationId, eq(schema.dropiOrderLink.contactId, contactId)
    )).orderBy(desc(schema.dropiOrderLink.createdAt)),
    db.select().from(schema.dropiOrderSubmission).where(scoped(
      schema.dropiOrderSubmission.organizationId, organizationId, eq(schema.dropiOrderSubmission.contactId, contactId)
    )).orderBy(desc(schema.dropiOrderSubmission.createdAt)),
  ]);
  const orders: DropiLinkedOrder[] = linked.map((row) => ({
    ...row.snapshot as unknown as Omit<DropiLinkedOrder, "updatedAt" | "source">,
    orderId: row.providerOrderId,
    createdAt: textValue(findValue(row.snapshot, ["created_at", "createdAt"])) ?? null,
    carrier: carrierFromOrder(row.snapshot),
    updatedAt: row.updatedAt.toISOString(),
    source: "linked",
  }));
  for (const row of submissions) {
    // A local Vocero shopOrderId (e.g. "voc-…") is not a Dropi order ID.
    // Only expose submissions as provider orders when Dropi returned a real ID.
    if (!row.providerOrderId) continue;
    const exists = orders.some((order) => order.orderId === row.providerOrderId);
    if (exists) continue;
    const productLines = Array.isArray(row.payload.products) ? row.payload.products : [];
    orders.push({
      orderId: row.providerOrderId,
      status: row.providerStatus ?? row.status,
      trackingCode: null, createdAt: row.createdAt.toISOString(), carrier: null, total: null, currency: null,
      items: productLines.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const entry = item as Record<string, unknown>;
        return [{ name: textValue(entry.name ?? entry.product_name ?? entry.id) ?? "Producto", quantity: textValue(entry.quantity ?? entry.qty) }];
      }),
      updatedAt: row.updatedAt.toISOString(),
      source: "vocero",
    });
  }
  return { connected: connection?.status === "connected", orders: orders.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
}

export async function linkDropiOrderToContact(organizationId: string, contactId: string, orderIdInput: string) {
  const orderId = orderIdInput.trim();
  if (!orderId || orderId.length > 100) throw new DropiLinkError("Escribe un ID de pedido válido.", "invalid_order_id");
  const connection = await getDropiConnection(organizationId);
  if (!connection || connection.status !== "connected") throw new DropiLinkError("Conecta Dropi antes de vincular pedidos.", "not_connected");
  const db = getDb();
  const contactRows = await db.select({ phone: schema.contact.phone, ficha: schema.contact.ficha }).from(schema.contact).where(scoped(
    schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)
  )).limit(1);
  if (!contactRows[0]) throw new DropiLinkError("Contacto no encontrado.", "contact_not_found");

  const tools = await listDropiTools(organizationId);
  const tool = tools.find((entry) => entry.name === "get_order");
  const inputSchema = tool?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  const idKey = Object.keys(inputSchema?.properties ?? {}).find((key) => ["id", "orderid", "order_id", "ordercode", "order_code"].includes(normalizedKey(key)));
  if (!tool || !idKey) throw new DropiLinkError("Dropi no ofrece una herramienta compatible para consultar pedidos.", "tool_unavailable");
  const args: Record<string, unknown> = { [idKey]: orderId };
  const missing = (inputSchema?.required ?? []).filter((key) => args[key] === undefined);
  if (missing.length) throw new DropiLinkError("Dropi exige datos adicionales para consultar ese pedido.", "missing_fields");
  const result = await callDropiTool(organizationId, "get_order", args);
  if (result.isError) throw new DropiLinkError("Dropi no pudo encontrar o consultar ese pedido.", "provider_error");
  const orderData = decodeOrder(result);
  const contactPhone = contactRows[0].phone ?? phoneFromFicha(contactRows[0].ficha);
  assertPhoneOwnership(contactPhone, orderData);
  // A ficha antigua puede contener un teléfono que aún no llegó al campo principal.
  // Tras verificarlo contra Dropi, lo promovemos para que el contacto quede corregido.
  if (!contactRows[0].phone && contactPhone) {
    await db.update(schema.contact).set({ phone: contactPhone, updatedAt: new Date() }).where(scoped(
      schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)
    ));
  }
  const snapshot = summaryFromOrder(orderId, orderData, "linked");
  const existing = await db.select().from(schema.dropiOrderLink).where(scoped(
    schema.dropiOrderLink.organizationId, organizationId, eq(schema.dropiOrderLink.providerOrderId, orderId)
  )).limit(1);
  if (existing[0] && existing[0].contactId !== contactId) {
    throw new DropiLinkError("Ese pedido ya está vinculado a otro contacto.", "already_linked");
  }
  if (existing[0]) {
    await db.update(schema.dropiOrderLink).set({ snapshot, updatedAt: new Date() }).where(scoped(
      schema.dropiOrderLink.organizationId, organizationId, eq(schema.dropiOrderLink.id, existing[0].id)
    ));
  } else {
    const now = new Date();
    await db.insert(schema.dropiOrderLink).values({
      id: newId("dropiOrderLink"), organizationId, contactId, providerOrderId: orderId, snapshot, createdAt: now, updatedAt: now,
    });
  }
  return snapshot;
}

export async function unlinkDropiOrderFromContact(organizationId: string, contactId: string, orderId: string) {
  const db = getDb();
  await db.delete(schema.dropiOrderLink).where(scoped(
    schema.dropiOrderLink.organizationId, organizationId,
    and(eq(schema.dropiOrderLink.contactId, contactId), eq(schema.dropiOrderLink.providerOrderId, orderId))
  ));
}

export type DropiOrganizationOrder = {
  orderId: string;
  providerOrderId: string | null;
  shopOrderId: string | null;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  status: string | null;
  trackingCode: string | null;
  createdAt: string | null;
  carrier: string | null;
  total: string | null;
  currency: string | null;
  items: { name: string; quantity: string | null; productId?: string | null }[];
  updatedAt: string;
  source: "linked" | "vocero";
};

function organizationOrderItems(value: unknown) {
  return findArray(value, ["items", "products", "order_items", "details"])
    .slice(0, 20)
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const productId = textValue(findValue(entry, ["product_retailer_id", "product_id", "productId", "id", "sku"]));
      const name = textValue(findValue(entry, ["product_name", "name", "title", "product"]));
      if (!name && !productId) return [];
      return [{ name: name ?? "Producto", quantity: textValue(findValue(entry, ["quantity", "qty"])), productId }];
    });
}

function productSignature(items: Array<{ productId?: string | null; quantity: string | null }>): string | null {
  const lines = items.flatMap((item) => {
    const productId = item.productId?.trim();
    if (!productId || !/^[1-9]\d{0,23}$/.test(productId)) return [];
    return [`${productId}:${item.quantity?.trim() || "1"}`];
  }).sort();
  return lines.length ? lines.join("|") : null;
}

/**
 * Actualiza desde Dropi los pedidos ya vinculados y reconcilia una solicitud
 * local de Vocero solo si coincide exactamente el contacto, productos y
 * cantidades con un único pedido importado recientemente.
 */
export async function refreshDropiOrders(organizationId: string) {
  const connection = await getDropiConnection(organizationId);
  if (!connection || connection.status !== "connected") {
    throw new DropiLinkError("Conecta Dropi para traer la información más reciente.", "not_connected");
  }

  const db = getDb();
  const [links, submissions, tools] = await Promise.all([
    db.select({
      id: schema.dropiOrderLink.id,
      providerOrderId: schema.dropiOrderLink.providerOrderId,
      contactId: schema.dropiOrderLink.contactId,
      snapshot: schema.dropiOrderLink.snapshot,
      createdAt: schema.dropiOrderLink.createdAt,
    }).from(schema.dropiOrderLink)
      .where(scoped(schema.dropiOrderLink.organizationId, organizationId))
      .orderBy(desc(schema.dropiOrderLink.updatedAt))
      .limit(10),
    db.select({
      id: schema.dropiOrderSubmission.id,
      providerOrderId: schema.dropiOrderSubmission.providerOrderId,
      status: schema.dropiOrderSubmission.status,
      payload: schema.dropiOrderSubmission.payload,
      contactId: schema.dropiOrderSubmission.contactId,
      createdAt: schema.dropiOrderSubmission.createdAt,
    }).from(schema.dropiOrderSubmission)
      .where(scoped(schema.dropiOrderSubmission.organizationId, organizationId))
      .orderBy(desc(schema.dropiOrderSubmission.createdAt)),
    listDropiTools(organizationId),
  ]);

  const tool = tools.find((entry) => entry.name === "get_order");
  const inputSchema = tool?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  const idKey = Object.keys(inputSchema?.properties ?? []).find((key) =>
    ["id", "orderid", "order_id", "ordercode", "order_code"].includes(normalizedKey(key))
  );
  if (!tool || !idKey) throw new DropiLinkError("Dropi no ofrece una herramienta compatible para consultar pedidos.", "tool_unavailable");
  const missing = (inputSchema?.required ?? []).filter((key) => key !== idKey);
  if (missing.length) throw new DropiLinkError("Dropi exige datos adicionales para consultar un pedido.", "missing_fields");

  const refreshed: Array<{
    id: string;
    providerOrderId: string;
    contactId: string;
    createdAt: Date;
    summary: DropiLinkedOrder;
  }> = [];
  for (const row of links) {
    try {
      const result = await callDropiTool(organizationId, "get_order", { [idKey]: row.providerOrderId });
      const data = decodeOrder(result);
      const summary = summaryFromOrder(row.providerOrderId, data, "linked");
      const now = new Date();
      await db.update(schema.dropiOrderLink).set({ snapshot: summary, updatedAt: now }).where(scoped(
        schema.dropiOrderLink.organizationId,
        organizationId,
        eq(schema.dropiOrderLink.id, row.id)
      ));
      refreshed.push({ id: row.id, providerOrderId: row.providerOrderId, contactId: row.contactId, createdAt: row.createdAt, summary });
    } catch (error) {
      console.warn("[orders] Dropi refresh failed for linked order", row.providerOrderId, error instanceof Error ? error.message : "unknown");
    }
  }

  const orphanSubmissions = submissions.filter((row) => !row.providerOrderId);
  const matchesBySubmission = new Map<string, typeof refreshed>();
  const matchesByProviderOrder = new Map<string, string[]>();
  const freshnessWindow = 7 * 24 * 60 * 60 * 1000;

  for (const submission of orphanSubmissions) {
    const signature = productSignature(organizationOrderItems(submission.payload));
    if (!signature) continue;
    const submissionTime = submission.createdAt.getTime();
    const candidates = refreshed.filter((order) =>
      order.contactId === submission.contactId &&
      Math.abs(order.createdAt.getTime() - submissionTime) <= freshnessWindow &&
      productSignature(order.summary.items) === signature
    );
    if (candidates.length !== 1) continue;
    matchesBySubmission.set(submission.id, candidates);
    const providerOrderId = candidates[0]!.providerOrderId;
    matchesByProviderOrder.set(providerOrderId, [...(matchesByProviderOrder.get(providerOrderId) ?? []), submission.id]);
  }

  let reconciledOrders = 0;
  for (const submission of orphanSubmissions) {
    const candidates = matchesBySubmission.get(submission.id);
    if (!candidates?.length) continue;
    const candidate = candidates[0]!;
    if (matchesByProviderOrder.get(candidate.providerOrderId)?.length !== 1) continue;
    await db.update(schema.dropiOrderSubmission).set({
      providerOrderId: candidate.providerOrderId,
      providerStatus: candidate.summary.status,
      status: "submitted",
      updatedAt: new Date(),
    }).where(scoped(
      schema.dropiOrderSubmission.organizationId,
      organizationId,
      eq(schema.dropiOrderSubmission.id, submission.id)
    ));
    reconciledOrders += 1;
  }

  return { refreshedOrders: refreshed.length, reconciledOrders, failedOrders: links.length - refreshed.length };
}

/** Lista pedidos creados desde Vocero y pedidos de Dropi vinculados, dentro de la organización. */
export async function listDropiOrders(organizationId: string) {
  const db = getDb();
  const [connection, linked, submissions, catalogProducts] = await Promise.all([
    getDropiConnection(organizationId),
    db.select({
      providerOrderId: schema.dropiOrderLink.providerOrderId,
      snapshot: schema.dropiOrderLink.snapshot,
      updatedAt: schema.dropiOrderLink.updatedAt,
      contactId: schema.contact.id,
      contactName: schema.contact.name,
      contactPhone: schema.contact.phone,
    }).from(schema.dropiOrderLink)
      .innerJoin(schema.contact, eq(schema.dropiOrderLink.contactId, schema.contact.id))
      .where(scoped(schema.dropiOrderLink.organizationId, organizationId))
      .orderBy(desc(schema.dropiOrderLink.updatedAt)),
    db.select({
      shopOrderId: schema.dropiOrderSubmission.shopOrderId,
      providerOrderId: schema.dropiOrderSubmission.providerOrderId,
      providerStatus: schema.dropiOrderSubmission.providerStatus,
      status: schema.dropiOrderSubmission.status,
      payload: schema.dropiOrderSubmission.payload,
      createdAt: schema.dropiOrderSubmission.createdAt,
      updatedAt: schema.dropiOrderSubmission.updatedAt,
      contactId: schema.contact.id,
      contactName: schema.contact.name,
      contactPhone: schema.contact.phone,
    }).from(schema.dropiOrderSubmission)
      .innerJoin(schema.contact, eq(schema.dropiOrderSubmission.contactId, schema.contact.id))
      .where(scoped(schema.dropiOrderSubmission.organizationId, organizationId))
      .orderBy(desc(schema.dropiOrderSubmission.updatedAt)),
    db.select({
      name: schema.metaCatalogProduct.name,
      attributes: schema.metaCatalogProduct.attributes,
    }).from(schema.metaCatalogProduct)
      .where(scoped(schema.metaCatalogProduct.organizationId, organizationId)),
  ]);

  const byProviderId = new Map<string, DropiOrganizationOrder>();
  for (const row of linked) {
    const snapshot = row.snapshot;
    byProviderId.set(row.providerOrderId, {
      orderId: row.providerOrderId,
      providerOrderId: row.providerOrderId,
      shopOrderId: null,
      contactId: row.contactId,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      status: textValue(findValue(snapshot, ["status", "order_status", "orderStatus"])),
      trackingCode: textValue(findValue(snapshot, ["tracking_code", "trackingCode", "tracking_number", "guide"])),
      createdAt: textValue(findValue(snapshot, ["created_at", "createdAt"])) ?? null,
      carrier: carrierFromOrder(snapshot),
      total: textValue(findValue(snapshot, ["total", "total_amount", "grand_total", "order_total"])),
      currency: textValue(findValue(snapshot, ["currency", "currency_code"])),
      items: organizationOrderItems(snapshot),
      updatedAt: row.updatedAt.toISOString(),
      source: "linked",
    });
  }

  const unlinked: DropiOrganizationOrder[] = [];
  for (const row of submissions) {
    if (row.providerOrderId && byProviderId.has(row.providerOrderId)) continue;
    const items = organizationOrderItems(row.payload);
    const payloadTotal = textValue(findValue(row.payload, ["total", "total_amount", "grand_total", "order_total"]));
    const order: DropiOrganizationOrder = {
      orderId: row.providerOrderId ?? row.shopOrderId,
      providerOrderId: row.providerOrderId,
      shopOrderId: row.shopOrderId,
      contactId: row.contactId,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      status: row.providerStatus ?? row.status,
      trackingCode: textValue(findValue(row.payload, ["tracking_code", "trackingCode", "tracking_number", "guide"])),
      createdAt: row.createdAt.toISOString(),
      carrier: carrierFromOrder(row.payload),
      total: payloadTotal,
      currency: textValue(findValue(row.payload, ["currency", "currency_code"])),
      items,
      updatedAt: row.updatedAt.toISOString(),
      source: "vocero",
    };
    if (row.providerOrderId) byProviderId.set(row.providerOrderId, order);
    else unlinked.push(order);
  }

  const localNameByDropiId = new Map<string, string>();
  for (const product of catalogProducts) {
    const productId = dropiProductIdFromAttributes(product.attributes);
    if (productId && !localNameByDropiId.has(productId)) localNameByDropiId.set(productId, product.name);
  }

  const orders = [...byProviderId.values(), ...unlinked]
    .map((order) => ({
      ...order,
      items: order.items.map((item) => ({
        ...item,
        name: item.productId ? localNameByDropiId.get(item.productId) ?? item.name : item.name,
      })),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { connected: connection?.status === "connected", orders };
}
