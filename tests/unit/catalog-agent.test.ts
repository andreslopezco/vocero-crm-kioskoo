import { describe, expect, it } from "vitest";
import { agentActionSchema, agentActionSchemaFor } from "@/server/ai/actions";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { parseCatalogFlag } from "@/server/catalog/flag";
import { catalogProductMutationSchema } from "@/server/catalog/input";
import { CATALOG_IMAGE_MAX_BYTES, validateCatalogImage } from "@/server/catalog/images";
import { catalogProductGraphPayload, catalogProductImageUrl, resolveInStockProducts, type CatalogSnapshot } from "@/server/catalog/service";
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
      dropiProductId: "12345",
      name: "Set de ollas",
      description: "Acero inoxidable",
      availability: "in stock",
      condition: "new",
      inventory: "100",
      price: "309900",
      currency: "cop",
      brand: "Keha",
      url: "https://tienda.example.com/olla",
      category: "Hogar",
      material: "Acero inoxidable",
      color: "Plateado",
      size: "5 y 7 litros",
      pattern: "",
    };
    const parsed = catalogProductMutationSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.currency).toBe("COP");
      expect(parsed.data.dropiProductId).toBe("12345");
    }
    expect(catalogProductMutationSchema.safeParse({ ...input, dropiProductId: "SKU-OLLAS-01" }).success).toBe(false);
    expect(catalogProductMutationSchema.safeParse({ ...input, dropiProductId: "0" }).success).toBe(false);
    expect(catalogProductMutationSchema.safeParse({ ...input, imageUrls: ["https://cdn.example.com/olla.jpg"] }).data).not.toHaveProperty("imageUrls");
    expect(catalogProductMutationSchema.safeParse({ ...input, url: "https://user:password@tienda.example.com" }).success).toBe(false);
    expect(catalogProductMutationSchema.safeParse({ ...input, price: "0" }).success).toBe(false);
  });

  it("mapea el precio a centavos y no incluye imágenes en las mutaciones", () => {
    const parsed = catalogProductMutationSchema.parse({
      retailerId: "SKU-OLLAS-01",
      name: "Set de ollas",
      description: "Acero inoxidable",
      availability: "in stock",
      condition: "new",
      inventory: "100",
      price: "309900",
      currency: "COP",
      brand: "Keha",
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
      material: "Acero inoxidable",
      quantity_to_sell_on_facebook: 100,
    });
    expect(createPayload).not.toHaveProperty("image_url");
    expect(createPayload).not.toHaveProperty("additional_image_urls");
    expect(catalogProductGraphPayload({ ...parsed, price: "309900.50" }, "create").price).toBe(30990050);
    expect(updatePayload).not.toHaveProperty("allow_upsert");
    expect(updatePayload).not.toHaveProperty("image_url");
    expect(updatePayload).not.toHaveProperty("additional_image_urls");
    expect(createPayload).not.toHaveProperty("catalog_id");
    expect(catalogProductMutationSchema.safeParse({ ...parsed, inventory: "1.5" }).success).toBe(false);
    expect(catalogProductGraphPayload({ ...parsed, inventory: "" }, "update")).not.toHaveProperty("quantity_to_sell_on_facebook");
  });

  it("prefiere la URL CDN más reciente de Meta para mostrar la imagen del producto", () => {
    expect(catalogProductImageUrl({
      image_url: "https://source.example.com/old.jpg",
      image_cdn_urls: [{ url: "https://cdn.example.com/current.jpg", width: "600" }],
    })).toBe("https://cdn.example.com/current.jpg");
    expect(catalogProductImageUrl({ image_url: "https://source.example.com/current.jpg" }))
      .toBe("https://source.example.com/current.jpg");
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

  it("el prompt de pedidos exige el mapeo local y no permite confirmar sin crear", () => {
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [{ name: "Interesado" }],
      dropi: {
        rateType: "CON RECAUDO",
        orderCreationEnabled: true,
        tools: [{ name: "create_order", inputSchema: { type: "object" } }],
        productData: "id: 12345, name: Bolso de cuero",
        catalogProducts: [{ retailerId: "SKU-01", name: "Bolso de cuero", dropiProductId: "12345", price: "120000", currency: "COP" }],
      },
    });
    expect(prompt).toContain("12345");
    expect(prompt).toContain("products[].id");
    expect(prompt).toContain("Nunca confirmes el pedido al cliente");
    expect(prompt).toContain("DEBES invocar create_dropi_order en este turno");
    expect(prompt).toContain("solicitud pendiente para revisión humana");
    expect(prompt).toContain("price y currency del producto local vinculado");
    expect(prompt).not.toContain("move_stage a la etapa de interesados y confirma al cliente");
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
