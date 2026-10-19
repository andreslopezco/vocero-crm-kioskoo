export const LOCAL_DROPI_PRODUCT_ID_ATTRIBUTE = "_local_dropi_product_id";

/** El mapeo local solo acepta IDs numéricos positivos que Dropi usa en sus órdenes. */
export function dropiProductIdFromAttributes(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>)[LOCAL_DROPI_PRODUCT_ID_ATTRIBUTE];
  return typeof id === "string" && /^[1-9]\d{0,23}$/.test(id) ? id : null;
}

/** Extrae y normaliza los IDs de productos que el agente propuso para la orden. */
export function dropiOrderProductIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = (item as Record<string, unknown>).id;
    const normalized = typeof id === "number" && Number.isSafeInteger(id)
      ? String(id)
      : typeof id === "string" ? id.trim() : "";
    if (!/^[1-9]\d{0,23}$/.test(normalized)) return null;
    ids.push(normalized);
  }
  return ids;
}

export function dropiOrderContainsOnlyMappedProducts(
  value: unknown,
  mappedProductIds: ReadonlySet<string>
): boolean {
  const ids = dropiOrderProductIds(value);
  return ids !== null && ids.every((id) => mappedProductIds.has(id));
}
