import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { appleTouchIconHref } from "@/lib/favicon";

describe("appleTouchIconHref", () => {
  it("usa siempre la ruta canónica de iOS, sin query string", () => {
    expect(
      appleTouchIconHref({
        ...DEFAULT_BRANDING,
        appIcon: { mime: "image/png", version: 1234 },
      })
    ).toBe("/apple-touch-icon.png");
  });

  it("conserva la ruta estándar para el icono generado", () => {
    expect(appleTouchIconHref(DEFAULT_BRANDING)).toBe("/apple-touch-icon.png");
  });
});
