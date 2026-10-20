import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getDropiConnection } from "./credentials";
import { phoneFromFicha } from "@/server/bot/ficha";
import { callDropiTool, callDropiTools, callDropiToolPages, listDropiTools } from "./mcp-client";
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
    const listHeader = line.match(/^\s*([\w-]+)\[\d+\]:\s*$/);
    if (listHeader) {
      const key = listHeader[1];
      if (!key) continue;
      activeArray = [];
      root[key] = activeArray;
      activeObject = null;
      itemHeaders = null;
      continue;
    }
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

    const listItem = line.match(/^\s+-\s*([\w-]+):(?:\s*(.*))?$/);
    if (listItem && activeArray) {
      const key = listItem[1];
      if (!key) continue;
      activeObject = {};
      activeArray.push(activeObject);
      activeObject[key] = parseScalar(listItem[2] ?? "");
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
function findNamedArray(value: unknown, name: string): unknown[] | undefined {
  const wanted = normalizedKey(name);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(record)) {
    if (normalizedKey(key) === wanted && Array.isArray(candidate)) return candidate;
  }
  for (const candidate of Object.values(record)) {
    const found = findNamedArray(candidate, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

function decodeOrderPage(result: {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}): unknown[] {
  if (result.isError) throw new DropiLinkError("Dropi no pudo consultar la lista de pedidos.", "provider_error");
  const candidates: unknown[] = [];
  if (result.structuredContent !== undefined && result.structuredContent !== null) candidates.push(result.structuredContent);
  for (const block of result.content ?? []) if (block.type === "text" && block.text) candidates.push(block.text);
  const arrayKeys = ["orders", "order_list", "orderlist", "results", "records", "data", "items"];
  for (const candidate of candidates) {
    let parsed: unknown = candidate;
    if (typeof parsed === "string") {
      const text = parsed;
      try { parsed = JSON.parse(text) as unknown; }
      catch { parsed = parseDropiText(text) ?? text; }
    }
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed) as unknown; } catch { continue; }
    }
    if (Array.isArray(parsed)) return parsed;
    for (const key of arrayKeys) {
      const rows = findNamedArray(parsed, key);
      if (rows !== undefined) return rows;
    }
  }
  throw new DropiLinkError("Dropi devolvió una lista de pedidos que no se pudo interpretar.", "invalid_response");
}

function providerOrderId(data: unknown): string | null {
  return textValue(findValue(data, ["provider_order_id", "order_id", "orderId", "code", "id"]));
}

function orderCustomer(data: unknown) {
  const customer = findValue(data, ["customer", "client", "recipient", "buyer"]);
  const scope = customer ?? data;
  return {
    phone: textValue(findValue(scope, ["customer_phone", "customerPhone", "phone_number", "phoneNumber", "cellphone", "mobile", "phone", "telephone"])),
    name: textValue(findValue(scope, ["customer_name", "full_name", "name", "contact_name"])),
  };
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

export async function listDropiOrdersForContact(organizationId: string, contactId: string) {
  const { connected, orders } = await listDropiOrders(organizationId);
  return {
    connected,
    orders: orders
      .filter((order) => order.contactId === contactId)
      .map((order) => ({
        orderId: order.providerOrderId ?? order.shopOrderId ?? order.orderId,
        status: order.status,
        trackingCode: order.trackingCode,
        carrier: order.carrier,
        createdAt: order.createdAt,
        total: order.total,
        currency: order.currency,
        items: order.items.map((item) => ({ name: item.name, quantity: item.quantity })),
        updatedAt: order.updatedAt,
        source: order.source === "vocero" ? "vocero" as const : "linked" as const,
        canUnlink: order.source === "linked",
      })),
  };
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
  contactId: string | null;
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
  source: "linked" | "vocero" | "dropi";
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
  const [submissions, contacts, links, tools] = await Promise.all([
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
    db.select({ id: schema.contact.id, name: schema.contact.name, phone: schema.contact.phone })
      .from(schema.contact).where(scoped(schema.contact.organizationId, organizationId)),
    db.select({ id: schema.dropiOrderLink.id, providerOrderId: schema.dropiOrderLink.providerOrderId })
      .from(schema.dropiOrderLink).where(scoped(schema.dropiOrderLink.organizationId, organizationId)),
    listDropiTools(organizationId),
  ]);

  const tool = tools.find((entry) => entry.name === "list_orders");
  const inputSchema = tool?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  const properties = inputSchema?.properties ?? {};
  const startKey = Object.keys(properties).find((key) => normalizedKey(key) === "start");
  const pageSizeKey = Object.keys(properties).find((key) => ["resultnumber", "pagesize", "limit"].includes(normalizedKey(key)));
  if (!tool || !startKey || !pageSizeKey) {
    throw new DropiLinkError("Dropi no ofrece una herramienta paginada compatible para importar todos los pedidos.", "list_orders_unavailable");
  }
  const missing = (inputSchema?.required ?? []).filter((key) => key !== startKey && key !== pageSizeKey);
  if (missing.length) throw new DropiLinkError("Dropi exige filtros adicionales para listar pedidos.", "missing_fields");

  const pageSize = 100;
  const pages = await callDropiToolPages(
    organizationId,
    "list_orders",
    (page) => ({ [startKey]: page * pageSize, [pageSizeKey]: pageSize }),
    (result) => decodeOrderPage(result).length >= pageSize
  );
  const providerRows = pages.flatMap((page) => decodeOrderPage(page));
  const contactIdsByPhone = new Map<string, string[]>();
  for (const contact of contacts) {
    const phone = normalizedPhone(contact.phone);
    if (phone) contactIdsByPhone.set(phone, [...(contactIdsByPhone.get(phone) ?? []), contact.id]);
  }

  const detailTool = tools.find((entry) => entry.name === "get_order");
  const detailSchema = detailTool?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  const detailProperties = detailSchema?.properties ?? {};
  const detailIdKey = Object.keys(detailProperties).find((key) =>
    ["id", "orderid", "order_id", "ordercode", "order_code"].includes(normalizedKey(key))
  );
  const detailMissing = (detailSchema?.required ?? []).filter((key) => key !== detailIdKey);
  const rowsNeedingDetails = providerRows.flatMap((row) => {
    const orderId = providerOrderId(row);
    return orderId && !summaryFromOrder(orderId, row, "linked").items.length ? [{ orderId, row }] : [];
  });
  const detailByOrderId = new Map<string, { data: unknown; summary: DropiLinkedOrder }>();
  if (detailIdKey && detailMissing.length === 0 && rowsNeedingDetails.length) {
    const results = await callDropiTools(
      organizationId,
      "get_order",
      rowsNeedingDetails.map(({ orderId }) => ({ [detailIdKey]: orderId }))
    );
    for (let index = 0; index < rowsNeedingDetails.length; index += 1) {
      const result = results[index];
      if (!result || result.isError) continue;
      try {
        const { orderId } = rowsNeedingDetails[index]!;
        const detail = decodeOrder(result);
        const summary = summaryFromOrder(orderId, detail, "linked");
        if (summary.items.length) detailByOrderId.set(orderId, { data: detail, summary });
      } catch {
        // Conserva el resumen importado si Dropi no entrega el detalle de un pedido.
      }
    }
  }

  const imported: Array<{
    orderId: string;
    contactId: string | null;
    createdAt: Date | null;
    summary: DropiLinkedOrder & { customerName: string | null; customerPhone: string | null };
  }> = [];
  const now = new Date();
  const seen = new Set<string>();
  for (const row of providerRows) {
    const orderId = providerOrderId(row);
    if (!orderId || seen.has(orderId)) continue;
    seen.add(orderId);
    const baseSummary = summaryFromOrder(orderId, row, "linked");
    const detail = detailByOrderId.get(orderId);
    const detailSummary = detail?.summary;
    const summary: DropiLinkedOrder = detailSummary ? {
      ...baseSummary,
      status: detailSummary.status ?? baseSummary.status,
      trackingCode: detailSummary.trackingCode ?? baseSummary.trackingCode,
      createdAt: detailSummary.createdAt ?? baseSummary.createdAt,
      carrier: detailSummary.carrier ?? baseSummary.carrier,
      total: detailSummary.total ?? baseSummary.total,
      currency: detailSummary.currency ?? baseSummary.currency,
      items: detailSummary.items.length ? detailSummary.items : baseSummary.items,
      updatedAt: detailSummary.updatedAt ?? baseSummary.updatedAt,
    } : baseSummary;
    const detailCustomer = detail ? orderCustomer(detail.data) : { name: null, phone: null };
    const listCustomer = orderCustomer(row);
    const customer = {
      name: detailCustomer.name ?? listCustomer.name,
      phone: detailCustomer.phone ?? listCustomer.phone,
    };
    const matches = contactIdsByPhone.get(normalizedPhone(customer.phone)) ?? [];
    const contactId = matches.length === 1 ? matches[0]! : null;
    imported.push({
      orderId,
      contactId,
      createdAt: summary.createdAt ? new Date(summary.createdAt) : null,
      summary: { ...summary, customerName: customer.name, customerPhone: customer.phone },
    });
  }

  for (let offset = 0; offset < imported.length; offset += 100) {
    const batch = imported.slice(offset, offset + 100);
    const timestamp = new Date();
    await db.insert(schema.dropiOrderSync).values(batch.map((order) => ({
      id: newId("dropiOrderSync"),
      organizationId,
      orderId: order.orderId,
      contactId: order.contactId,
      snapshot: order.summary as unknown as Record<string, unknown>,
      ignored: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }))).onConflictDoUpdate({
      target: [schema.dropiOrderSync.organizationId, schema.dropiOrderSync.orderId],
      set: {
        contactId: sql`coalesce(${schema.dropiOrderSync.contactId}, excluded.contact_id)`,
        snapshot: sql`excluded.snapshot`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
  }

  const linkByProviderId = new Map(links.map((link) => [link.providerOrderId, link.id]));
  for (const order of imported) {
    const linkId = linkByProviderId.get(order.orderId);
    if (!linkId) continue;
    await db.update(schema.dropiOrderLink).set({ snapshot: order.summary as unknown as Record<string, unknown>, updatedAt: now })
      .where(scoped(schema.dropiOrderLink.organizationId, organizationId, eq(schema.dropiOrderLink.id, linkId)));
  }

  const orphanSubmissions = submissions.filter((row) => !row.providerOrderId);
  const matchesBySubmission = new Map<string, typeof imported>();
  const matchesByProviderOrder = new Map<string, string[]>();
  const freshnessWindow = 7 * 24 * 60 * 60 * 1000;

  for (const submission of orphanSubmissions) {
    const signature = productSignature(organizationOrderItems(submission.payload));
    if (!signature) continue;
    const submissionTime = submission.createdAt.getTime();
    const candidates = imported.filter((order) =>
      order.contactId === submission.contactId &&
      order.createdAt !== null &&
      Math.abs(order.createdAt.getTime() - submissionTime) <= freshnessWindow &&
      productSignature(order.summary.items) === signature
    );
    if (candidates.length !== 1) continue;
    matchesBySubmission.set(submission.id, candidates);
    const providerId = candidates[0]!.orderId;
    matchesByProviderOrder.set(providerId, [...(matchesByProviderOrder.get(providerId) ?? []), submission.id]);
  }

  let reconciledOrders = 0;
  for (const submission of orphanSubmissions) {
    const candidates = matchesBySubmission.get(submission.id);
    if (!candidates?.length) continue;
    const candidate = candidates[0]!;
    if (matchesByProviderOrder.get(candidate.orderId)?.length !== 1) continue;
    await db.update(schema.dropiOrderSubmission).set({
      providerOrderId: candidate.orderId,
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

  return { refreshedOrders: imported.length, reconciledOrders, failedOrders: 0 };
}

/** Asigna un pedido importado de Dropi a un contacto existente, sin cambiar el pedido remoto. */
export async function assignDropiOrderToContact(organizationId: string, orderIdInput: string, contactIdInput: string) {
  const orderId = orderIdInput.trim();
  const contactId = contactIdInput.trim();
  if (!orderId || orderId.length > 100) throw new DropiLinkError("ID de pedido no válido.", "invalid_order_id");
  if (!contactId || contactId.length > 100) throw new DropiLinkError("Selecciona un contacto válido.", "invalid_contact_id");

  const db = getDb();
  const [order] = await db.select({ contactId: schema.dropiOrderSync.contactId })
    .from(schema.dropiOrderSync)
    .where(scoped(
      schema.dropiOrderSync.organizationId,
      organizationId,
      and(eq(schema.dropiOrderSync.orderId, orderId), eq(schema.dropiOrderSync.ignored, false))
    ))
    .limit(1);
  if (!order) throw new DropiLinkError("No se encontró ese pedido importado de Dropi.", "order_not_found");
  if (order.contactId) throw new DropiLinkError("Ese pedido ya está asignado a un contacto.", "already_assigned");

  const [contact] = await db.select({ id: schema.contact.id })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)))
    .limit(1);
  if (!contact) throw new DropiLinkError("El contacto seleccionado no existe en esta organización.", "contact_not_found");

  const [updated] = await db.update(schema.dropiOrderSync)
    .set({ contactId, updatedAt: new Date() })
    .where(scoped(
      schema.dropiOrderSync.organizationId,
      organizationId,
      and(
        eq(schema.dropiOrderSync.orderId, orderId),
        eq(schema.dropiOrderSync.ignored, false),
        isNull(schema.dropiOrderSync.contactId)
      )
    ))
    .returning({ id: schema.dropiOrderSync.id });
  if (!updated) throw new DropiLinkError("El pedido acaba de ser asignado. Actualiza la lista e inténtalo de nuevo.", "already_assigned");
}

/** Oculta un pedido de la tabla de Vocero; nunca cancela ni elimina el pedido en Dropi. */
export async function dismissDropiOrder(organizationId: string, orderIdInput: string) {
  const orderId = orderIdInput.trim();
  if (!orderId || orderId.length > 100) throw new DropiLinkError("ID de pedido no válido.", "invalid_order_id");
  const now = new Date();
  await getDb().insert(schema.dropiOrderSync).values({
    id: newId("dropiOrderSync"),
    organizationId,
    orderId,
    contactId: null,
    snapshot: {},
    ignored: true,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [schema.dropiOrderSync.organizationId, schema.dropiOrderSync.orderId],
    set: { ignored: true, updatedAt: now },
  });
}

/** Restaura un pedido ocultado en Vocero; no realiza cambios en Dropi. */
export async function restoreDropiOrder(organizationId: string, orderIdInput: string) {
  const orderId = orderIdInput.trim();
  if (!orderId || orderId.length > 100) throw new DropiLinkError("ID de pedido no válido.", "invalid_order_id");
  const [restored] = await getDb().update(schema.dropiOrderSync)
    .set({ ignored: false, updatedAt: new Date() })
    .where(scoped(
      schema.dropiOrderSync.organizationId,
      organizationId,
      and(eq(schema.dropiOrderSync.orderId, orderId), eq(schema.dropiOrderSync.ignored, true))
    ))
    .returning({ id: schema.dropiOrderSync.id });
  if (!restored) throw new DropiLinkError("No se encontró ese pedido en los eliminados.", "order_not_found");
}

/** Lista pedidos creados desde Vocero y pedidos de Dropi vinculados, dentro de la organización. */
export async function listDropiOrders(organizationId: string) {
  const db = getDb();
  const [connection, linked, submissions, syncedOrders, ignoredOrders, catalogProducts] = await Promise.all([
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
      orderId: schema.dropiOrderSync.orderId,
      snapshot: schema.dropiOrderSync.snapshot,
      contactId: schema.dropiOrderSync.contactId,
      contactName: schema.contact.name,
      contactPhone: schema.contact.phone,
      updatedAt: schema.dropiOrderSync.updatedAt,
    }).from(schema.dropiOrderSync)
      .leftJoin(schema.contact, eq(schema.dropiOrderSync.contactId, schema.contact.id))
      .where(scoped(schema.dropiOrderSync.organizationId, organizationId, eq(schema.dropiOrderSync.ignored, false)))
      .orderBy(desc(schema.dropiOrderSync.updatedAt)),
    db.select({
      orderId: schema.dropiOrderSync.orderId,
      snapshot: schema.dropiOrderSync.snapshot,
      contactId: schema.dropiOrderSync.contactId,
      contactName: schema.contact.name,
      contactPhone: schema.contact.phone,
      updatedAt: schema.dropiOrderSync.updatedAt,
    }).from(schema.dropiOrderSync)
      .leftJoin(schema.contact, eq(schema.dropiOrderSync.contactId, schema.contact.id))
      .where(scoped(schema.dropiOrderSync.organizationId, organizationId, eq(schema.dropiOrderSync.ignored, true)))
      .orderBy(desc(schema.dropiOrderSync.updatedAt)),
    db.select({
      name: schema.metaCatalogProduct.name,
      attributes: schema.metaCatalogProduct.attributes,
    }).from(schema.metaCatalogProduct)
      .where(scoped(schema.metaCatalogProduct.organizationId, organizationId)),
  ]);

  const hiddenIds = new Set(ignoredOrders.map((row) => row.orderId));
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

  for (const row of syncedOrders) {
    if (byProviderId.has(row.orderId)) continue;
    const customer = orderCustomer(row.snapshot);
    byProviderId.set(row.orderId, {
      orderId: row.orderId,
      providerOrderId: row.orderId,
      shopOrderId: null,
      contactId: row.contactId,
      contactName: row.contactName ?? customer.name ?? "Sin contacto asociado",
      contactPhone: row.contactPhone ?? customer.phone,
      status: textValue(findValue(row.snapshot, ["status", "order_status", "orderStatus"])),
      trackingCode: textValue(findValue(row.snapshot, ["tracking_code", "trackingCode", "tracking_number", "guide"])),
      createdAt: textValue(findValue(row.snapshot, ["created_at", "createdAt"])) ?? null,
      carrier: carrierFromOrder(row.snapshot),
      total: textValue(findValue(row.snapshot, ["total", "total_amount", "grand_total", "order_total"])),
      currency: textValue(findValue(row.snapshot, ["currency", "currency_code"])),
      items: organizationOrderItems(row.snapshot),
      updatedAt: row.updatedAt.toISOString(),
      source: "dropi",
    });
  }

  for (const row of ignoredOrders) {
    if (byProviderId.has(row.orderId)) continue;
    const customer = orderCustomer(row.snapshot);
    byProviderId.set(row.orderId, {
      orderId: row.orderId,
      providerOrderId: row.orderId,
      shopOrderId: null,
      contactId: row.contactId,
      contactName: row.contactName ?? customer.name ?? "Sin contacto asociado",
      contactPhone: row.contactPhone ?? customer.phone,
      status: textValue(findValue(row.snapshot, ["status", "order_status", "orderStatus"])),
      trackingCode: textValue(findValue(row.snapshot, ["tracking_code", "trackingCode", "tracking_number", "guide"])),
      createdAt: textValue(findValue(row.snapshot, ["created_at", "createdAt"])) ?? null,
      carrier: carrierFromOrder(row.snapshot),
      total: textValue(findValue(row.snapshot, ["total", "total_amount", "grand_total", "order_total"])),
      currency: textValue(findValue(row.snapshot, ["currency", "currency_code"])),
      items: organizationOrderItems(row.snapshot),
      updatedAt: row.updatedAt.toISOString(),
      source: "dropi",
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
    .sort((a, b) => {
      const aCreated = Date.parse(a.createdAt ?? a.updatedAt);
      const bCreated = Date.parse(b.createdAt ?? b.updatedAt);
      const aTimestamp = Number.isFinite(aCreated) ? aCreated : 0;
      const bTimestamp = Number.isFinite(bCreated) ? bCreated : 0;
      return bTimestamp - aTimestamp || b.updatedAt.localeCompare(a.updatedAt);
    });
  return {
    connected: connection?.status === "connected",
    orders: orders.filter((order) => !hiddenIds.has(order.providerOrderId ?? order.shopOrderId ?? order.orderId)),
    deletedOrders: orders.filter((order) => hiddenIds.has(order.providerOrderId ?? order.shopOrderId ?? order.orderId)),
  };
}
