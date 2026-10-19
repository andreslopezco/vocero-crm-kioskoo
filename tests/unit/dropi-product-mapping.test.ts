import { describe, expect, it } from "vitest";
import {
  dropiOrderContainsOnlyMappedProducts,
  dropiOrderProductIds,
  dropiProductIdFromAttributes,
  LOCAL_DROPI_PRODUCT_ID_ATTRIBUTE,
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

  it("rechaza productos de Dropi que no estén vinculados en el catálogo local", () => {
    const mapped = new Set(["12345"]);
    expect(dropiOrderContainsOnlyMappedProducts([{ id: 12345, quantity: 1 }], mapped)).toBe(true);
    expect(dropiOrderContainsOnlyMappedProducts([{ id: 67890, quantity: 1 }], mapped)).toBe(false);
    expect(dropiOrderContainsOnlyMappedProducts([], mapped)).toBe(false);
  });
});
