import { describe, expect, it } from "vitest";
import {
  dropiOrderContainsOnlyMappedProducts,
  dropiOrderProductIds,
  dropiProductIdFromAttributes,
  LOCAL_DROPI_PRODUCT_ID_ATTRIBUTE,
  dropiPayloadFromConfirmedFicha,
  isAffirmativeOrderSummaryConfirmation,
} from "@/server/dropi/product-mapping";

describe("mapeo de productos locales a Dropi", () => {
  it("lee únicamente un ID numérico válido del atributo local reservado", () => {
    expect(dropiProductIdFromAttributes({ [LOCAL_DROPI_PRODUCT_ID_ATTRIBUTE]: "12345" })).toBe("12345");
    expect(dropiProductIdFromAttributes({ [LOCAL_DROPI_PRODUCT_ID_ATTRIBUTE]: "0" })).toBeNull();
    expect(dropiProductIdFromAttributes({ [LOCAL_DROPI_PRODUCT_ID_ATTRIBUTE]: "sku-1" })).toBeNull();
    expect(dropiProductIdFromAttributes({ dropi_product_id: "12345" })).toBeNull();
  });

  it("normaliza IDs numéricos de las líneas de pedido", () => {
    expect(dropiOrderProductIds([{ id: 12345, quantity: 2 }])).toEqual(["12345"]);
    expect(dropiOrderProductIds([{ id: "12345", quantity: 2 }])).toEqual(["12345"]);
    expect(dropiOrderProductIds([])).toBeNull();
    expect(dropiOrderProductIds([{ id: "no-es-numero", quantity: 1 }])).toBeNull();
  });


  it("prepara un pedido al confirmar el resumen cuando la ficha y el SKU están completos", () => {
    const payload = dropiPayloadFromConfirmedFicha({
      ficha: {
        "Nombre completo": "Andrés López",
        Telefono: "3102307059",
        Departamento: "Santander",
        Ciudad: "Floridablanca",
        Direccion: "Cra 24 #35-30 Blq 6 Apto 503",
        Correo: "andres@example.com",
        Cantidad: "1",
        SKU: "SKU-01",
      },
      catalogProducts: [{
        retailerId: "SKU-01",
        name: "Set de ollas",
        dropiProductId: "12345",
        price: "309900 COP",
        currency: "COP",
      }],
      rateType: "CON RECAUDO",
      createOrderSchema: {
        type: "object",
        properties: {
          name: {}, surname: {}, phone: {}, state: {}, city: {}, dir: {},
          client_email: {}, rate_type: {},
          products: { items: { properties: { id: {}, price: {}, quantity: {} }, required: ["id", "price", "quantity"] } },
        },
        required: ["name", "surname", "phone", "state", "city", "dir", "products", "rate_type"],
      },
    });
    expect(payload).toMatchObject({
      name: "Andrés",
      surname: "López",
      phone: "3102307059",
      state: "Santander",
      city: "Floridablanca",
      dir: "Cra 24 #35-30 Blq 6 Apto 503",
      client_email: "andres@example.com",
      rate_type: "CON RECAUDO",
      products: [{ id: 12345, price: 309900, quantity: 1 }],
    });
    expect(dropiPayloadFromConfirmedFicha({
      ficha: { "Nombre completo": "Andrés López", SKU: "NO-MAP", Cantidad: "1" },
      catalogProducts: [],
      createOrderSchema: { type: "object" },
      rateType: "CON RECAUDO",
    })).toBeNull();
  });

  it("reconoce una respuesta afirmativa solo después de un resumen de pedido", () => {
    const history = [{ direction: "out", text: "Te confirmo el resumen de tu solicitud. ¿Todo está correcto?" }];
    expect(isAffirmativeOrderSummaryConfirmation("Sí, todo está correcto", history)).toBe(true);
    expect(isAffirmativeOrderSummaryConfirmation("Sí, pero cambia la dirección", history)).toBe(false);
    expect(isAffirmativeOrderSummaryConfirmation("Sí", [{ direction: "out", text: "Hola, ¿en qué puedo ayudarte?" }])).toBe(false);
  });

  it("rechaza productos de Dropi que no estén vinculados en el catálogo local", () => {
    const mapped = new Set(["12345"]);
    expect(dropiOrderContainsOnlyMappedProducts([{ id: 12345, quantity: 1 }], mapped)).toBe(true);
    expect(dropiOrderContainsOnlyMappedProducts([{ id: 67890, quantity: 1 }], mapped)).toBe(false);
    expect(dropiOrderContainsOnlyMappedProducts([], mapped)).toBe(false);
  });
});
