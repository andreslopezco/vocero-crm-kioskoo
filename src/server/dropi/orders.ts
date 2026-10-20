import { createHash } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getDropiConnection } from "./credentials";
import { getCatalogSnapshot } from "@/server/catalog/service";
import { dropiOrderContainsOnlyMappedProducts, dropiOrderProductIds, dropiProductIdFromAttributes } from "./product-mapping";
import { callDropiTool, listDropiTools } from "./mcp-client";

const EXPECTED_STATUS = "PENDIENTE CONFIRMACION";

export class DropiOrderError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

export async function dropiPromptContext(organizationId: string, query: string) {
  const connection = await getDropiConnection(organizationId);
  if (!connection || connection.status !== "connected") return null;
  let productData: string | null = null;
  const localCatalog = await getCatalogSnapshot(organizationId);
  const catalogProducts = (localCatalog?.products ?? []).flatMap((product) => {
    const dropiProductId = dropiProductIdFromAttributes(product.attributes);
    return dropiProductId ? [{ retailerId: product.retailerId, name: product.name, dropiProductId, price: product.price, currency: product.currency }] : [];
  });
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
    catalogProducts,
  };
}


type MappedOrderProduct = { retailerId: string; name: string; dropiProductId: string; price: string | null; currency: string | null };

function normalizedFichaKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fichaText(ficha: Record<string, string | number | boolean | null>, names: string[]): string | null {
  const wanted = new Set(names.map(normalizedFichaKey));
  for (const [key, value] of Object.entries(ficha)) {
    if (!wanted.has(normalizedFichaKey(key)) || (typeof value !== "string" && typeof value !== "number")) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function parseCatalogOrderPrice(value: string | null): number | null {
  if (!value) return null;
  const raw = value.trim().replace(/[^0-9.,-]/g, "");
  if (!raw || !/\d/.test(raw)) return null;
  const lastSeparator = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
  let normalized = raw;
  if (lastSeparator >= 0 && raw.length - lastSeparator - 1 <= 2) {
    const decimal = raw.slice(lastSeparator + 1);
    const whole = raw.slice(0, lastSeparator).replace(/[^0-9-]/g, "");
    normalized = `${whole}.${decimal}`;
  } else {
    normalized = raw.replace(/[^0-9-]/g, "");
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * Respaldo determinista para la confirmación de un resumen de pedido.
 * Solo arma el payload si toda la información está en la ficha y el SKU
 * apunta a un producto local ya vinculado a Dropi.
 */
export function dropiPayloadFromConfirmedFicha(input: {
  ficha: Record<string, string | number | boolean | null>;
  catalogProducts: MappedOrderProduct[];
  createOrderSchema: unknown;
  rateType: string;
}): Record<string, unknown> | null {
  if (!input.rateType.trim()) return null;
  const schemaDef = input.createOrderSchema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  } | null;
  if (!schemaDef || schemaDef.type !== "object") return null;
  const properties = schemaDef.properties ?? {};
  const propertyKey = (candidates: string[], source: Record<string, unknown> = properties) =>
    Object.keys(source).find((key) => candidates.includes(normalizedFichaKey(key)));
  const readProperty = (key: string) => properties[key] as {
    items?: { properties?: Record<string, unknown>; required?: string[] };
  } | undefined;

  const sku = fichaText(input.ficha, ["sku", "retailerId", "productSku"]);
  const interest = fichaText(input.ficha, ["producto interes", "producto", "product"]);
  const normalizedSku = sku ? normalizedFichaKey(sku) : null;
  const normalizedInterest = interest ? normalizedFichaKey(interest) : null;
  const product = input.catalogProducts.find((item) =>
    (normalizedSku && normalizedFichaKey(item.retailerId) === normalizedSku) ||
    (normalizedInterest && normalizedFichaKey(item.name) === normalizedInterest)
  );
  if (!product) return null;
  const productId = dropiProductIdFromAttributes({ [LOCAL_DROPI_PRODUCT_ID_ATTRIBUTE]: product.dropiProductId });
  const price = parseCatalogOrderPrice(product.price);
  const quantityText = fichaText(input.ficha, ["cantidad", "quantity"]);
  const quantity = quantityText && /^\d+$/.test(quantityText) ? Number(quantityText) : NaN;
  if (!productId || !price || !Number.isSafeInteger(quantity) || quantity <= 0) return null;

  const fullName = fichaText(input.ficha, ["nombre completo", "nombre", "name"]);
  const nameParts = fullName?.split(/\s+/).filter(Boolean) ?? [];
  if (nameParts.length < 2) return null;
  const values: Record<string, unknown> = {};
  const set = (candidates: string[], value: unknown) => {
    const key = propertyKey(candidates);
    if (key) values[key] = value;
    return key;
  };
  set(["name", "firstName", "customerName"], nameParts[0]);
  set(["surname", "lastName", "customerSurname"], nameParts.slice(1).join(" "));
  set(["phone", "customerPhone"], fichaText(input.ficha, ["telefono", "celular", "phone"]));
  set(["state", "department", "destinationDepartment"], fichaText(input.ficha, ["departamento", "state"]));
  set(["city", "destinationCity"], fichaText(input.ficha, ["ciudad", "city"]));
  set(["dir", "address", "deliveryAddress"], fichaText(input.ficha, ["direccion", "dirección", "address"]));
  set(["clientEmail", "email", "customerEmail"], fichaText(input.ficha, ["correo", "email"]));
  set(["rateType"], input.rateType);

  const productsKey = propertyKey(["products"]);
  if (!productsKey) return null;
  const itemSchema = readProperty(productsKey)?.items;
  const itemProperties = itemSchema?.properties;
  if (!itemProperties) return null;
  const itemKey = (candidates: string[]) => propertyKey(candidates, itemProperties);
  const idKey = itemKey(["id", "productId"]);
  const priceKey = itemKey(["price", "unitPrice"]);
  const quantityKey = itemKey(["quantity", "qty"]);
  if (!idKey || !priceKey || !quantityKey) return null;
  const productLine: Record<string, unknown> = {
    [idKey]: Number(productId),
    [priceKey]: price,
    [quantityKey]: quantity,
  };
  if ((itemSchema.required ?? []).some((key) => productLine[key] === undefined)) return null;
  values[productsKey] = [productLine];

  const missing = (schemaDef.required ?? []).filter((key) => values[key] === undefined || values[key] === null || values[key] === "");
  return missing.length ? null : values;
}

export function isAffirmativeOrderSummaryConfirmation(affirmation: string, history: { direction: string; text: string | null }[]): boolean {
  const answer = normalizedFichaKey(affirmation);
  const affirmativeAnswers = new Set([
    "si", "siestacorrecto", "sitodoestacorrecto", "sitodoescorrecto",
    "correcto", "todocorrecto", "confirmo", "confirmado", "asi",
  ]);
  if (!affirmativeAnswers.has(answer)) return false;
  const priorSummary = [...history].reverse().find((message) => message.direction === "out" && message.text);
  if (!priorSummary?.text) return false;
  const summary = normalizedFichaKey(priorSummary.text);
  return summary.includes("resumen") &&
    (summary.includes("solicitud") || summary.includes("pedido")) &&
    (summary.includes("confirmacion") || summary.includes("correcto"));
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
  const productsKey = Object.keys(properties).find((key) => key.toLowerCase() === "products");
  if (!productsKey) throw new DropiOrderError("Dropi no expone productos en el esquema de creación de órdenes.", "tool_unavailable");
  const productIds = dropiOrderProductIds(payload[productsKey]);
  if (!productIds) throw new DropiOrderError("Falta seleccionar al menos un producto y su cantidad para el pedido.", "missing_fields");
  const localCatalog = await getCatalogSnapshot(input.organizationId);
  const mappedProductIds = new Set((localCatalog?.products ?? [])
    .map((product) => dropiProductIdFromAttributes(product.attributes))
    .filter((id): id is string => id !== null));
  if (!dropiOrderContainsOnlyMappedProducts(payload[productsKey], mappedProductIds)) {
    throw new DropiOrderError("El producto elegido no tiene un ID de Dropi vinculado en el Catálogo. Vincúlalo antes de crear el pedido.", "product_unmapped");
  }
  payload[productsKey] = (payload[productsKey] as Array<Record<string, unknown>>)
    .map((item) => ({ ...item, id: Number(item.id) }));
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
