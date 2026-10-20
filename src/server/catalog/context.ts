import type { CatalogSnapshot } from "@/server/catalog/service";
import type { Channel } from "@/lib/channels";
import { capabilitiesFor } from "@/server/channels/capabilities";

const MAX_CONTEXT_PRODUCTS = 25;
const MAX_VISIBLE_CATEGORIES = 8;
const TOKEN = /[\p{L}\p{N}]{2,}/gu;
const GENERAL_CATALOG_PATTERNS = [
  /\bque (?:productos|articulos|opciones) (?:tienes|tienen|manejas|manejan|hay)(?: disponibles)?\b/u,
  /\b(?:ver|mostrar|muestrame|ensenarme|ensename|comparteme) (?:el |tu )?catalogo\b/u,
  /^(?:productos|catalogo|que tienes|que tienen|que hay disponible)$/u,
];
const GENERIC_CATALOG_TERMS = new Set([
  "algo", "articulo", "articulos", "busco", "catalogo", "cual", "cuales",
  "dame", "de", "del", "disponible", "disponibles", "el", "en", "hay",
  "la", "las", "lo", "los", "manejan", "manejas", "me", "mostrar",
  "muestra", "muestrame", "opcion", "opciones", "para", "producto",
  "productos", "que", "quiero", "quisiera", "tienen", "tienes", "tu", "un",
  "una", "ver",
]);
const CUSTOMER_ATTRIBUTES: Record<string, string> = {
  category: "Categoría",
  condition: "Estado",
  material: "Material",
  size: "Tamaño",
  color: "Color",
  pattern: "Diseño",
  gender: "Público",
  age_group: "Grupo de edad",
  product_type: "Tipo",
  origin_country: "País de origen",
};
const CONDITION_LABELS: Record<string, string> = {
  new: "nuevo",
  refurbished: "reacondicionado",
  used: "usado",
};

function asAttributes(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Los atributos técnicos del feed de Meta nunca se presentan al cliente. */
export function customerFacingCatalogAttributes(value: unknown): Record<string, string> {
  const attributes = asAttributes(value);
  return Object.fromEntries(Object.entries(CUSTOMER_ATTRIBUTES)
    .flatMap(([key, label]) => {
      const value = attributes[key];
      if (value == null || value === "") return [];
      const raw = typeof value === "string" ? value : JSON.stringify(value);
      const localized = key === "condition" && typeof raw === "string"
        ? (CONDITION_LABELS[raw.toLocaleLowerCase()] ?? raw)
        : raw;
      return localized ? [[label, stripCatalogLinks(localized)]] : [];
    }));
}

export function stripCatalogLinks(text: string): string {
  return text
    .replace(/(?:https?:\/\/|www\.)\S+/giu, "")
    .replace(/\b(?:más detalles en|ver más en|ver en|consulta en|disponible en)\s*$/iu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t.,;:|—-]+$/g, "")
    .trim();
}

export function customerFacingCatalogDescription(product: CatalogSnapshot["products"][number]): string | null {
  const attributes = asAttributes(product.attributes);
  const description = product.description
    ?? (typeof attributes.short_description === "string" ? attributes.short_description : null)
    ?? (typeof attributes.rich_text_description === "string" ? attributes.rich_text_description : null);
  return description ? stripCatalogLinks(description) || null : null;
}

function normalizedCatalogText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type CatalogCategoryGroup = { name: string; count: number };

function catalogProductCategory(product: CatalogSnapshot["products"][number]): string | null {
  const category = asAttributes(product.attributes).category;
  if (typeof category !== "string") return null;
  return stripCatalogLinks(category) || null;
}

/** Categorías reales publicadas por Meta, deduplicadas sin inventar etiquetas. */
export function catalogCategoryGroups(snapshot: CatalogSnapshot): CatalogCategoryGroup[] {
  const groups = new Map<string, CatalogCategoryGroup>();
  for (const product of snapshot.products) {
    if (product.availability !== "in stock") continue;
    const category = catalogProductCategory(product);
    if (!category) continue;
    const key = normalizedCatalogText(category);
    if (!key) continue;
    const current = groups.get(key);
    if (current) current.count += 1;
    else groups.set(key, { name: category, count: 1 });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function selectedCategory(
  categories: CatalogCategoryGroup[],
  normalizedQuery: string
): CatalogCategoryGroup | null {
  return categories
    .map((category) => ({ category, normalized: normalizedCatalogText(category.name) }))
    .filter(({ normalized }) => normalized.length >= 3 && (
      normalizedQuery.includes(normalized)
      || (normalizedQuery.length >= 3 && normalized.includes(normalizedQuery))
    ))
    .sort((a, b) => b.normalized.length - a.normalized.length)[0]?.category ?? null;
}

function hasCategoryCriterion(query: string, category: string): boolean {
  const categoryTerms = new Set(normalizedCatalogText(category).split(" "));
  return normalizedCatalogText(query)
    .split(" ")
    .some((term) => term.length >= 3 && !categoryTerms.has(term) && !GENERIC_CATALOG_TERMS.has(term));
}

/**
 * Respuesta determinista para explorar el catálogo antes de recomendar.
 * Evita que una pregunta abierta dispare una selección arbitraria de tarjetas.
 */
export function catalogGuidanceForTurn(snapshot: CatalogSnapshot, query: string): string | null {
  const normalizedQuery = normalizedCatalogText(query);
  if (!normalizedQuery) return null;
  const available = snapshot.products.filter((product) => product.availability === "in stock");
  const categories = catalogCategoryGroups(snapshot);
  const category = selectedCategory(categories, normalizedQuery);

  if (category && category.count > 3 && !hasCategoryCriterion(query, category.name)) {
    return `En ${category.name} tengo varias opciones. ¿Buscas algún tipo de producto, uso o presupuesto en particular? Así te muestro las más relevantes.`;
  }
  // Ya eligió una categoría acotada (o añadió un criterio): el turno puede
  // continuar al modelo para seleccionar las tarjetas relevantes.
  if (category) return null;

  if (!GENERAL_CATALOG_PATTERNS.some((pattern) => pattern.test(normalizedQuery))) return null;
  if (available.length === 0) {
    return "En este momento no aparecen productos disponibles en el catálogo. Si me dices qué buscas, puedo ayudarte a confirmar alternativas con el equipo.";
  }
  if (categories.length === 0) {
    return "¡Claro! Para orientarte mejor, ¿qué tipo de producto buscas o para qué lo necesitas? Si quieres, dime también tu presupuesto.";
  }
  if (categories.length === 1) {
    return `Tenemos productos en ${categories[0]!.name}. ¿Qué tipo de producto buscas o para qué lo necesitas?`;
  }
  const visible = categories.slice(0, MAX_VISIBLE_CATEGORIES);
  const intro = categories.length > MAX_VISIBLE_CATEGORIES
    ? "Estas son algunas categorías disponibles:"
    : "Tenemos productos en estas categorías:";
  const closing = categories.length > MAX_VISIBLE_CATEGORIES
    ? "¿Cuál te interesa? Si buscas otra cosa, dime qué necesitas y te oriento."
    : "¿Cuál te interesa?";
  return [intro, ...visible.map((item) => `• ${item.name}`), closing].join("\n");
}

/**
 * La introducción acompaña la tarjeta o el resumen, pero nunca vuelve a listar
 * los mismos productos. Si el modelo repite un nombre/precio o se extiende,
 * el servidor usa una frase breve y estable.
 */
export function catalogProductsIntro(
  products: CatalogSnapshot["products"],
  suggested?: string
): string {
  const fallback = products.length === 1
    ? "Te comparto esta opción disponible:"
    : "Te comparto estas opciones disponibles:";
  const clean = suggested ? stripCatalogLinks(suggested) : "";
  if (!clean || clean.length > 180 || clean.includes("\n")) return fallback;
  const normalized = normalizedCatalogText(clean);
  const repeatsProduct = products.some((product) => {
    const name = normalizedCatalogText(product.name);
    const pricing = catalogProductPricing(product);
    const prices = [pricing.currentPrice, pricing.originalPrice]
      .filter((price): price is string => Boolean(price))
      .map(normalizedCatalogText);
    return (name.length > 0 && normalized.includes(name))
      || prices.some((price) => price.length > 0 && normalized.includes(price));
  });
  return repeatsProduct ? fallback : clean;
}

/** Selección lexical acotada para no enviar catálogos enteros al proveedor de IA. */
export function catalogContextForTurn(
  snapshot: CatalogSnapshot,
  query: string,
  limit = MAX_CONTEXT_PRODUCTS
): CatalogSnapshot {
  const products = snapshot.products.filter((product) => product.availability === "in stock");
  const terms = [...new Set(query.toLocaleLowerCase().match(TOKEN) ?? [])];
  const ranked = products.map((product, position) => {
    const fields = [product.name, product.description, product.brand, product.retailerId, JSON.stringify(product.attributes)]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    const score = terms.reduce((total, term) => total + (fields.includes(term) ? (product.name.toLocaleLowerCase().includes(term) ? 3 : 1) : 0), 0);
    return { product, position, score };
  });
  ranked.sort((a, b) => b.score - a.score || a.position - b.position);
  return { ...snapshot, products: ranked.slice(0, Math.max(0, limit)).map(({ product }) => product) };
}

type CatalogProduct = CatalogSnapshot["products"][number];

function parseMetaDate(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function displayPrice(value: unknown, currency: string | null): string | null {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") return null;
  const raw = String(value).trim();
  return /\b[A-Z]{3}\s*$/u.test(raw) || !currency ? raw : `${raw} ${currency}`;
}

/** Meta conserva el precio normal en price y la oferta/fechas en attributes. */
export function catalogProductPricing(product: CatalogProduct, now = new Date()) {
  const attributes = asAttributes(product.attributes);
  const originalPrice = displayPrice(product.price, product.currency);
  const salePrice = displayPrice(attributes.sale_price, product.currency);
  const startsAt = parseMetaDate(attributes.sale_price_start_date);
  const endsAt = parseMetaDate(attributes.sale_price_end_date);
  const nowMs = now.getTime();
  const activeSale = Boolean(salePrice)
    && (startsAt === null || nowMs >= startsAt)
    && (endsAt === null || nowMs <= endsAt);

  return {
    originalPrice,
    salePrice: activeSale ? salePrice : null,
    currentPrice: activeSale ? salePrice : originalPrice,
    isOnSale: activeSale,
  };
}

/** Formato verificable para el fallback de texto y canales sin tarjeta nativa. */
export function catalogProductsText(
  products: CatalogSnapshot["products"],
  channel: Channel,
  intro?: string,
  mode: "summary" | "details" = "details"
): string {
  const lines = products.map((product) => {
    const pricing = catalogProductPricing(product);
    if (mode === "summary") {
      const priceText = pricing.isOnSale
        ? `${pricing.currentPrice} (antes ${pricing.originalPrice})`
        : pricing.currentPrice;
      return `• ${product.name}${priceText ? ` — ${priceText}` : ""}`;
    }
    const attributes = customerFacingCatalogAttributes(product.attributes);
    const details = [
      product.brand ? `Marca: ${product.brand}` : null,
      pricing.currentPrice ? `Precio: ${pricing.currentPrice}${pricing.isOnSale ? " (en oferta)" : ""}` : null,
      pricing.isOnSale && pricing.originalPrice ? `Antes: ${pricing.originalPrice}` : null,
      customerFacingCatalogDescription(product),
      ...Object.entries(attributes).map(([label, value]) => `${label}: ${value}`),
    ].filter((part): part is string => Boolean(part));
    return [`• ${product.name}`, ...details.map((detail) => `  ${detail}`)].join("\n");
  });
  const safeIntro = intro ? stripCatalogLinks(intro) : "";
  const text = [safeIntro || null, ...lines].filter(Boolean).join("\n\n");
  // Reutilizar los límites declarados por canal; byte-limit se mide en UTF-8
  // para no exceder Meta por acentos o emojis.
  const { maxTextChars, maxTextBytes } = capabilitiesFor(channel);
  const fits = (value: string) =>
    (maxTextChars === null || value.length <= maxTextChars) &&
    (maxTextBytes === null || new TextEncoder().encode(value).byteLength <= maxTextBytes);
  if (fits(text)) return text;
  const points = [...text];
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(`${points.slice(0, middle).join("")}…`)) low = middle;
    else high = middle - 1;
  }
  const clipped = points.slice(0, low).join("");
  const lastLine = clipped.lastIndexOf("\n");
  return `${clipped.slice(0, lastLine > clipped.length * 0.65 ? lastLine : undefined)}…`;
}
