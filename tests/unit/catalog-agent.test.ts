import { describe, expect, it } from "vitest";
import { agentActionSchema, agentActionSchemaFor } from "@/server/ai/actions";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { parseCatalogFlag } from "@/server/catalog/flag";
import { catalogProductMutationSchema } from "@/server/catalog/input";
import { CATALOG_IMAGE_MAX_BYTES, validateCatalogImage } from "@/server/catalog/images";
import { catalogProductGraphPayload, resolveInStockProducts, type CatalogSnapshot } from "@/server/catalog/service";
import { catalogContextForTurn, catalogProductsText } from "@/server/catalog/context";

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
  it("valida los campos para crear/editar y normaliza moneda, sin aceptar URLs inseguras", () => {
    const input = {
      retailerId: "SKU-OLLAS-01",
      name: "Set de ollas",
      description: "Acero inoxidable",
      availability: "in stock",
      condition: "new",
      price: "309900",
      currency: "cop",
      brand: "Keha",
      imageUrls: ["https://cdn.example.com/olla.jpg", "https://cdn.example.com/olla-lateral.png"],
      url: "https://tienda.example.com/olla",
      category: "Hogar",
      material: "Acero inoxidable",
      color: "Plateado",
      size: "5 y 7 litros",
      pattern: "",
    };
    const parsed = catalogProductMutationSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.currency).toBe("COP");
    expect(catalogProductMutationSchema.safeParse({ ...input, imageUrls: ["http://cdn.example.com/olla.jpg"] }).success).toBe(false);
    expect(catalogProductMutationSchema.safeParse({ ...input, imageUrls: Array(11).fill("https://cdn.example.com/olla.jpg") }).success).toBe(false);
    expect(catalogProductMutationSchema.safeParse({ ...input, url: "https://user:password@tienda.example.com" }).success).toBe(false);
    expect(catalogProductMutationSchema.safeParse({ ...input, price: "0" }).success).toBe(false);
  });

  it("mapea el precio a centavos para Meta y solo habilita upsert para una edición", () => {
    const parsed = catalogProductMutationSchema.parse({
      retailerId: "SKU-OLLAS-01",
      name: "Set de ollas",
      description: "Acero inoxidable",
      availability: "in stock",
      condition: "new",
      price: "309900",
      currency: "COP",
      brand: "Keha",
      imageUrls: ["https://cdn.example.com/olla.jpg", "https://cdn.example.com/olla-lateral.jpg"],
      url: "https://tienda.example.com/olla",
      category: "Hogar",
      material: "Acero inoxidable",
      color: "Plateado",
      size: "5 y 7 litros",
      pattern: "",
    });
    const createPayload = catalogProductGraphPayload(parsed, "create");
    const updatePayload = catalogProductGraphPayload(parsed, "update");
    expect(createPayload).toMatchObject({
      allow_upsert: false,
      retailer_id: "SKU-OLLAS-01",
      price: 30990000,
      currency: "COP",
      image_url: "https://cdn.example.com/olla.jpg",
      additional_image_urls: ["https://cdn.example.com/olla-lateral.jpg"],
      material: "Acero inoxidable",
    });
    expect(catalogProductGraphPayload({ ...parsed, price: "309900.50" }, "create").price).toBe(30990050);
    expect(updatePayload.allow_upsert).toBe(true);
    expect(createPayload).not.toHaveProperty("catalog_id");
  });

  it("valida tamaño, formato y dimensiones de las imágenes Meta", () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
    new DataView(png.buffer).setUint32(16, 500);
    new DataView(png.buffer).setUint32(20, 500);
    expect(validateCatalogImage(png, "image/png")).toMatchObject({ width: 500, height: 500, mimeType: "image/png" });
    expect(() => validateCatalogImage(png, "image/webp")).toThrow("JPEG o PNG");
    expect(() => validateCatalogImage(new Uint8Array(CATALOG_IMAGE_MAX_BYTES + 1), "image/png")).toThrow("8 MB");
    const small = new Uint8Array(png);
    new DataView(small.buffer).setUint32(16, 499);
    expect(() => validateCatalogImage(small, "image/png")).toThrow("500 × 500");
  });

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
    const productWithPlatformFields = {
      ...product,
      imageUrl: "https://cdn.example.com/product.jpg",
      url: "https://shop.example.com/product",
      attributes: { material: "acero inoxidable", status: "PUBLISHED", inventory: 100, visibility: "published" },
    };
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      catalog: { ...catalog, products: [productWithPlatformFields, { ...product, retailerId: "OUT", availability: "out of stock" }] },
    });
    expect(prompt).toContain("SKU-01");
    expect(prompt).toContain("acero inoxidable");
    expect(prompt).not.toContain("PUBLISHED");
    expect(prompt).not.toContain("inventory");
    expect(prompt).not.toContain("cdn.example.com");
    expect(prompt).not.toContain("shop.example.com");
    expect(prompt).toContain("No incluyas enlaces ni URLs");
    expect(prompt).not.toContain('"retailerId":"OUT"');
    expect(prompt).toContain("send_products");
    expect(prompt).toContain("no inventes propiedades, precios o disponibilidad");
  });

  it("no menciona el catálogo en absoluto cuando la flag está apagada", () => {
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      catalogEnabled: false,
      channel: "whatsapp",
    });
    expect(prompt.toLocaleLowerCase()).not.toContain("catálogo");
    expect(prompt).not.toContain("send_products");
  });

  it("describe la función activa aunque aún no exista un snapshot fresco", () => {
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      catalogEnabled: true,
      channel: "tiktok",
    });
    expect(prompt).toContain("Función de productos activa para TikTok");
    expect(prompt).toContain("No hay snapshot fresco");
    expect(prompt).not.toContain("send_products");
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

  it("construye ficha comercial, sin metadatos técnicos ni enlaces", () => {
    const message = catalogProductsText(
      [{
        ...product,
        description: "Olla de acero. https://tienda.example.com/olla",
      imageUrl: "https://cdn.example.com/olla.jpg",
        url: "https://tienda.example.com/olla",
        attributes: {
          material: "acero inoxidable",
          status: "PUBLISHED",
          condition: "new",
          inventory: 100,
          custom_number_0: 0,
        },
      }],
      "tiktok",
      "Mira esta opción https://tienda.example.com"
    );
    expect(message).toContain("Mira esta opción");
    expect(message).toContain("Bolso de cuero");
    expect(message).toContain("Precio: 120000 COP");
    expect(message).toContain("Olla de acero");
    expect(message).toContain("Material: acero inoxidable");
    expect(message).toContain("Estado: nuevo");
    expect(message).not.toContain("PUBLISHED");
    expect(message).not.toContain("inventory");
    expect(message).not.toContain("custom_number");
    expect(message).not.toContain("https://");
    expect(message).not.toContain("cdn.example.com");
  });
});
