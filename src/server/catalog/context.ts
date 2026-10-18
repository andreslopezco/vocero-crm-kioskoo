import type { CatalogSnapshot } from "@/server/catalog/service";

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
