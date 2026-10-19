import type { CatalogSnapshot } from "@/server/catalog/service";
import type { Channel } from "@/lib/channels";
import { capabilitiesFor } from "@/server/channels/capabilities";

const MAX_CONTEXT_PRODUCTS = 25;
const TOKEN = /[\p{L}\p{N}]{2,}/gu;
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

/** Formato verificable para el fallback de texto y canales sin tarjeta nativa. */
export function catalogProductsText(
  products: CatalogSnapshot["products"],
  channel: Channel,
  intro?: string
): string {
  const lines = products.map((product) => {
    const attributes = customerFacingCatalogAttributes(product.attributes);
    const details = [
      product.brand ? `Marca: ${product.brand}` : null,
      product.price ? `Precio: ${product.price}${product.currency ? ` ${product.currency}` : ""}` : null,
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
