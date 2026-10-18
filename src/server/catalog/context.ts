import type { CatalogSnapshot } from "@/server/catalog/service";
import type { Channel } from "@/lib/channels";
import { capabilitiesFor } from "@/server/channels/capabilities";

const MAX_CONTEXT_PRODUCTS = 25;
const TOKEN = /[\p{L}\p{N}]{2,}/gu;

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
    const details = [
      product.brand ? `Marca: ${product.brand}` : null,
      product.price ? `Precio: ${product.price}${product.currency ? ` ${product.currency}` : ""}` : null,
      product.description,
      ...Object.entries(product.attributes ?? {}).map(([key, value]) => {
        if (value == null || value === "") return null;
        const rendered = typeof value === "string" ? value : JSON.stringify(value);
        return `${key.replaceAll("_", " ")}: ${rendered}`;
      }),
      product.imageUrl ? `Imagen: ${product.imageUrl}` : null,
      product.url ? `Ver producto: ${product.url}` : null,
    ].filter((part): part is string => Boolean(part));
    return [`• ${product.name}`, ...details.map((detail) => `  ${detail}`)].join("\n");
  });
  const text = [intro?.trim() || null, ...lines].filter(Boolean).join("\n\n");
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
