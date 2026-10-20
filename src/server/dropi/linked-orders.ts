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
  return value.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
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
  let digits = (value ?? "").replace(/\\D/g, "");
  if (digits.startsWith("57") && digits.length === 12) digits = digits.slice(2);
  return digits;
}

function decodeOrder(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\\n").trim();
  try { return JSON.parse(text) as unknown; } catch { throw new DropiLinkError("Dropi devolvió una respuesta de pedido que no se pudo interpretar.", "invalid_response"); }
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
    if (!row.providerOrderId && !row.shopOrderId) continue;
    const exists = orders.some((order) => order.orderId === (row.providerOrderId ?? row.shopOrderId));
    if (exists) continue;
    const productLines = Array.isArray(row.payload.products) ? row.payload.products : [];
    orders.push({
      orderId: row.providerOrderId ?? row.shopOrderId,
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