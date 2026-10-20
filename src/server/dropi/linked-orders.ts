import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getDropiConnection } from "./credentials";
import { callDropiTool, listDropiTools } from "./mcp-client";

export class DropiLinkError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export type DropiLinkedOrder = {
  orderId: string;
  status: string | null;
  trackingCode: string | null;
  total: string | null;
  currency: string | null;
  items: { name: string; quantity: string | null }[];
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
  if (/^-?\\d+(?:\\.\\d+)?$/.test(unquoted)) return Number(unquoted);
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
  let itemHeaders: string[] | null = null;

  for (const line of text.split(/\\r?\\n/)) {
    if (!line.trim()) continue;
    const tableHeader = line.match(/^\\s*([\\w-]+)\\[\\d+\\]\\{([^}]+)\\}:\\s*$/);
    if (tableHeader) {
      const key = tableHeader[1];
      itemHeaders = tableHeader[2].split(",").map((part) => part.trim());
      root[key] = [];
      activeObject = null;
      continue;
    }

    const field = line.match(/^(\\s*)([\\w-]+):(?:\\s*(.*))?$/);
    if (field) {
      const indent = field[1].length;
      const key = field[2];
      const value = field[3] ?? "";
      if (indent === 0) {
        itemHeaders = null;
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

    if (itemHeaders && /^\\s+/.test(line)) {
      const values = splitDelimitedRow(line.trim());
      if (values.length > itemHeaders.length && itemHeaders.length >= 3) {
        const trailingColumns = itemHeaders.length - 2;
        values.splice(1, values.length - trailingColumns - 1, values.slice(1, values.length - trailingColumns).join(","));
      }
      const item = Object.fromEntries(itemHeaders.map((key, index) => [key, parseScalar(values[index] ?? "")]));
      const key = Object.keys(root).find((candidate) => Array.isArray(root[candidate]) && candidate.toLowerCase().includes("item"));
      const target = key ? root[key] as unknown[] : null;
      if (target) target.push(item);
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
    const trimmed = candidate.trim().replace(/^\`\`\`(?:json)?\\s*/i, "").replace(/\\s*\`\`\`$/, "");
    const candidates = [trimmed, trimmed.match(/[\\[{][\\s\\S]*[\\]}]/)?.[0]];
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
  const combined = text.join("\\n");
  const parsedCombined = parseJson(combined);
  if (parsedCombined !== undefined) return parsedCombined;
  const structuredCombined = parseDropiText(combined);
  if (structuredCombined !== undefined) return structuredCombined;
  throw new DropiLinkError("Dropi devolvió una respuesta de pedido que no se pudo interpretar.", "invalid_response");
}
function summaryFromOrder(orderId: string, data: unknown, source: DropiLinkedOrder["source"]): DropiLinkedOrder {
  const rawItems = findArray(data, ["products", "items", "order_items", "details"]);
  const items = rawItems.slice(0, 20).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const name = textValue(findValue(entry, ["product_name", "name", "title", "product"]));
    const quantity = textValue(findValue(entry, ["quantity", "qty"]));
    return name ? [{ name, quantity }] : [];
  });
  const updated = findValue(data, ["updated_at", "updatedAt", "created_at", "createdAt"]);
  return {
    orderId,
    status: textValue(findValue(data, ["status", "order_status", "orderStatus"])),
    trackingCode: textValue(findValue(data, ["tracking_code", "trackingCode", "tracking_number", "guide"])),
    total: textValue(findValue(data, ["total", "total_amount", "grand_total", "order_total"])),
    currency: textValue(findValue(data, ["currency", "currency_code"])),
    items,
    updatedAt: textValue(updated) ?? new Date().toISOString(),
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
      trackingCode: null, total: null, currency: null,
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
  const contactRows = await db.select({ phone: schema.contact.phone }).from(schema.contact).where(scoped(
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
  assertPhoneOwnership(contactRows[0].phone, orderData);
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