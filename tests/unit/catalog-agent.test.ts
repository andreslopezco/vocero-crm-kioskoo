import { describe, expect, it } from "vitest";
import { agentActionSchema, agentActionSchemaFor } from "@/server/ai/actions";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { parseCatalogFlag } from "@/server/catalog/flag";
import { resolveInStockProducts, type CatalogSnapshot } from "@/server/catalog/service";
import { catalogContextForTurn } from "@/server/catalog/context";

const product = {
  id: "p1",
  organizationId: "org_1",
  catalogId: "catalog_1",
  retailerId: "SKU-01",
  name: "Bolso de cuero",
  description: "Hecho a mano",
  availability: "in stock",
  price: "120000 COP",
  currency: "COP",
  brand: "Kioskoo",
  imageUrl: null,
  url: null,
  attributes: { material: "cuero" },
  createdAt: new Date(),
  updatedAt: new Date(),
};
const catalog: CatalogSnapshot = {
  catalogId: "catalog_1",
  catalogName: "Tienda",
  syncedAt: new Date(),
  products: [product],
};
const profile = {
  name: "Sofía",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
} as Parameters<typeof buildAgentSystemPrompt>[0]["profile"];

describe("catálogo Meta del agente (031)", () => {
  it("la bandera está apagada por omisión y solo acepta valores explícitos", () => {
    expect(parseCatalogFlag(undefined)).toBe(false);
    expect(parseCatalogFlag("off")).toBe(false);
    expect(parseCatalogFlag(" ON ")).toBe(true);
  });

  it("send_products no existe en el contrato apagado y valida IDs acotados cuando está activo", () => {
    const action = { action: "send_products", retailerIds: ["SKU-01"] };
    expect(agentActionSchema(false).safeParse(action).success).toBe(false);
    expect(agentActionSchemaFor(false, true).safeParse(action).success).toBe(true);
    expect(agentActionSchemaFor(false, true).safeParse({ ...action, retailerIds: Array(31).fill("SKU-01") }).success).toBe(false);
  });

  it("el prompt separa el catálogo Meta del conocimiento general y excluye agotados", () => {
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      catalog: { ...catalog, products: [product, { ...product, retailerId: "OUT", availability: "out of stock" }] },
    });
    expect(prompt).toContain("SKU-01");
    expect(prompt).not.toContain('"retailerId":"OUT"');
    expect(prompt).toContain("send_products");
    expect(prompt).toContain("no inventes propiedades, precios o disponibilidad");
  });

  it("recupera productos relevantes sin inyectar agotados ni todo un catálogo grande", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      ...product,
      retailerId: `SKU-${index}`,
      name: index === 38 ? "Zapatos de cuero" : `Producto ${index}`,
      availability: index === 39 ? "out of stock" : "in stock",
    }));
    const context = catalogContextForTurn({ ...catalog, products: many }, "busco zapatos de cuero");
    expect(context.products).toHaveLength(25);
    expect(context.products[0]?.retailerId).toBe("SKU-38");
    expect(context.products.some((item) => item.availability !== "in stock")).toBe(false);
  });

  it("el servidor solo resuelve IDs exactos en stock y deduplica la selección", () => {
    expect(resolveInStockProducts(catalog, ["SKU-01", "SKU-01"])).toHaveLength(1);
    expect(resolveInStockProducts(catalog, ["NO-EXISTE"])).toBeNull();
    expect(resolveInStockProducts({ ...catalog, products: [{ ...product, availability: "out of stock" }] }, ["SKU-01"])).toBeNull();
  });
});
