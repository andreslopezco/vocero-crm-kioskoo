import { describe, expect, it } from "vitest";
import { phoneFromFicha } from "@/server/bot/ficha";

describe("teléfono principal capturado en la ficha", () => {
  it("agrega 57 a un celular colombiano cuando la dirección lo confirma", () => {
    expect(phoneFromFicha({
      Telefono: "310 230 7059",
      Ciudad: "Floridablanca",
      Departamento: "Santander",
    })).toBe("573102307059");
  });

  it("reconoce un país Colombia explícito y no duplica un prefijo existente", () => {
    expect(phoneFromFicha({ phone: "+57 310 230 7059", País: "Colombia" }))
      .toBe("573102307059");
  });

  it("no inventa código de país si la ubicación no es concluyente", () => {
    expect(phoneFromFicha({ Telefono: "3102307059" })).toBe("3102307059");
  });

  it("ignora valores que no parecen teléfonos", () => {
    expect(phoneFromFicha({ Teléfono: "llamar al cliente" })).toBeNull();
    expect(phoneFromFicha({ Telefono: "123" })).toBeNull();
  });
});
