import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { appleTouchIconHref } from "@/lib/favicon";

describe("appleTouchIconHref", () => {
  it("usa una ruta nueva por versión para renovar el caché de Web Clips", () => {
    expect(
      appleTouchIconHref({
        ...DEFAULT_BRANDING,
        appIcon: { mime: "image/png", version: 1234 },
      })
    ).toBe("/pwa/apple/1234-opaque/icon.png");
  });

  it("conserva la ruta estándar para el icono generado", () => {
    expect(appleTouchIconHref(DEFAULT_BRANDING)).toBe("/apple-touch-icon.png");
  });
});
