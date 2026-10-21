import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { appleTouchIconHref } from "@/lib/favicon";

describe("appleTouchIconHref", () => {
  it("usa la ruta estándar de iOS y versiona el icono personalizado", () => {
    expect(
      appleTouchIconHref({
        ...DEFAULT_BRANDING,
        appIcon: { mime: "image/png", version: 1234 },
      })
    ).toBe("/apple-touch-icon.png?v=1234");
  });

  it("conserva la ruta estándar para el icono generado", () => {
    expect(appleTouchIconHref(DEFAULT_BRANDING)).toBe("/apple-touch-icon.png");
  });
});
