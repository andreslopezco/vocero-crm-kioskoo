import { createHash } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getDropiConnection } from "./credentials";
import { callDropiTool, listDropiTools } from "./mcp-client";

const EXPECTED_STATUS = "PENDIENTE CONFIRMACION";

export class DropiOrderError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export async function dropiPromptContext(organizationId: string, query: string) {
  const connection = await getDropiConnection(organizationId);
  if (!connection || connection.status !== "connected") return null;
  let productData: string | null = null;
  const productTool = connection.bundle.tools?.find((tool) => tool.name === "list_products");
  const productSchema = productTool?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  if (productTool) {
    const args: Record<string, unknown> = {};
    for (const key of Object.keys(productSchema?.properties ?? {})) {
      if (["query", "search", "search_term", "text", "name", "keyword"].includes(key.toLowerCase()) && query.trim()) args[key] = query.slice(0, 200);
      if (["limit", "page_size", "per_page"].includes(key.toLowerCase())) args[key] = 10;
    }
    const required = productSchema?.required ?? [];
    if (required.every((key) => args[key] !== undefined)) {
      try {
        const result = await callDropiTool(organizationId, "list_products", args);
        if (!result.isError) productData = result.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").slice(0, 9000);
      } catch { /* lectura auxiliar: un fallo no tumba la respuesta del agente */ }
    }
  }
  return {
    rateType: connection.rateType,
    orderCreationEnabled: connection.orderCreationEnabled,
    tools: connection.bundle.tools ?? [],
    productData,
  };
}

export async function createPendingOrder(input: {
  organizationId: string;
  conversationId: string;
  contactId: string;
  isTest: boolean;
  payload: Record<string, unknown>;
  ficha?: Record<string, string | number | boolean>;
}) {
  if (input.isTest) throw new DropiOrderError("El Laboratorio nunca crea pedidos reales.", "test_conversation");
  const connection = await getDropiConnection(input.organizationId);
  if (!connection || connection.status !== "connected") throw new DropiOrderError("Dropi no está conectado.", "not_connected");
  if (!connection.orderCreationEnabled) throw new DropiOrderError("La creación de pedidos está apagada en Ajustes → Dropi.", "creation_disabled");
  if (!connection.rateType) throw new DropiOrderError("Configura el tipo de recaudo en Ajustes → Dropi.", "rate_type_missing");

  const db = getDb();
  const prior = await db.select().from(schema.dropiOrderSubmission).where(scoped(
    schema.dropiOrderSubmission.organizationId,
    input.organizationId,
    eq(schema.dropiOrderSubmission.conversationId, input.conversationId),
    inArray(schema.dropiOrderSubmission.status, ["submitting", "submitted", "unknown", "needs_review"])
  )).orderBy(desc(schema.dropiOrderSubmission.createdAt)).limit(1);
  if (prior[0]) throw new DropiOrderError("Ya existe un intento de pedido para esta conversación. El equipo debe revisarlo en Dropi antes de intentar otra vez.", "duplicate_blocked");

  const tools = await listDropiTools(input.organizationId);
  const createTool = tools.find((tool) => tool.name === "create_order");
  const schemaDef = createTool?.inputSchema as { type?: string; properties?: Record<string, unknown>; required?: string[] } | undefined;
  if (!createTool || !schemaDef || schemaDef.type !== "object") throw new DropiOrderError("Dropi no expone un esquema válido para crear pedidos.", "tool_unavailable");
  const properties = schemaDef.properties ?? {};
  const payload = { ...input.payload };
  // Shop ID is mandatory for local reconciliation; do not submit if the official
  // tool cannot receive it because a timeout could otherwise create duplicates.
  const shopOrderKey = Object.keys(properties).find((key) => key.toLowerCase() === "shop_order_id");
  if (!shopOrderKey) throw new DropiOrderError("La herramienta de Dropi no permite una clave externa para evitar pedidos duplicados.", "idempotency_unavailable");
  const shopOrderId = `voc-${createHash("sha256").update(`${input.organizationId}:${input.conversationId}`).digest("hex").slice(0, 24)}`;
  payload[shopOrderKey] = shopOrderId;
  const rateTypeKey = Object.keys(properties).find((key) => key.toLowerCase() === "rate_type");
  if (rateTypeKey && (payload[rateTypeKey] === undefined || payload[rateTypeKey] === null || payload[rateTypeKey] === "")) {
    payload[rateTypeKey] = connection.rateType;
  }
  const missing = (schemaDef.required ?? []).filter((key) => payload[key] === undefined || payload[key] === null || payload[key] === "");
  if (missing.length) throw new DropiOrderError(`Faltan datos obligatorios del pedido: ${missing.join(", ")}.`, "missing_fields");

  const rowId = newId("dropiOrderSubmission");
  const now = new Date();
  const inserted = await db.insert(schema.dropiOrderSubmission).values({
    id: rowId, organizationId: input.organizationId, conversationId: input.conversationId,
    contactId: input.contactId, shopOrderId, payload, status: "submitting", createdAt: now, updatedAt: now,
  }).onConflictDoNothing({ target: [schema.dropiOrderSubmission.organizationId, schema.dropiOrderSubmission.shopOrderId] }).returning();
  if (!inserted.length) throw new DropiOrderError("Ese pedido ya fue enviado a Dropi; revisa el resultado antes de repetir.", "duplicate_blocked");

  try {
    const created = await callDropiTool(input.organizationId, "create_order", payload);
    if (created.isError) throw new Error("Dropi rechazó la creación del pedido.");
    const createData = decodeToolResult(created);
    const orderId = findValue(createData, ["order_id", "id", "orderId"]);
    let verified: unknown = createData;
    if (typeof orderId === "string" || typeof orderId === "number") {
      const getTool = tools.find((tool) => tool.name === "get_order");
      const getSchema = getTool?.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
      const idKey = Object.keys(getSchema?.properties ?? {}).find((key) => ["order_id", "id", "orderid"].includes(key.toLowerCase()));
      if (getTool && idKey) {
        const result = await callDropiTool(input.organizationId, "get_order", { [idKey]: orderId });
        if (!result.isError) verified = decodeToolResult(result);
      }
    }
    const status = findValue(verified, ["status", "order_status", "orderStatus"]);
    const normalizedStatus = typeof status === "string" ? status.trim().toUpperCase() : null;
    const expected = normalizedStatus === EXPECTED_STATUS;
    await db.update(schema.dropiOrderSubmission).set({
      providerOrderId: orderId === undefined ? null : String(orderId),
      providerStatus: normalizedStatus,
      status: expected ? "submitted" : "needs_review",
      updatedAt: new Date(),
    }).where(scoped(schema.dropiOrderSubmission.organizationId, input.organizationId, eq(schema.dropiOrderSubmission.id, rowId)));
    return { orderId: orderId === undefined ? null : String(orderId), status: normalizedStatus, readyForHumanReview: expected, ficha: input.ficha };
  } catch (error) {
    const uncertain = !(error instanceof DropiOrderError);
    await db.update(schema.dropiOrderSubmission).set({
      status: uncertain ? "unknown" : "failed",
      lastError: error instanceof Error ? error.message.slice(0, 400) : "Error al crear el pedido.",
      updatedAt: new Date(),
    }).where(scoped(schema.dropiOrderSubmission.organizationId, input.organizationId, eq(schema.dropiOrderSubmission.id, rowId)));
    throw error;
  }
}

function decodeToolResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const text = result.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
  try { return JSON.parse(text) as unknown; } catch { return text; }
}

function findValue(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) if (record[key] !== undefined) return record[key];
  for (const child of Object.values(record)) {
    const found = findValue(child, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}
