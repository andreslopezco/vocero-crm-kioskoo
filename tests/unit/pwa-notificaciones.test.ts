import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePushHabilitado } from "@/server/push/flag";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");

describe("notificaciones push opcionales", () => {
  it("permanecen apagadas si falta la bandera o una clave VAPID", () => {
    expect(parsePushHabilitado({})).toBe(false);
    expect(parsePushHabilitado({ flag: "on" })).toBe(false);
    expect(
      parsePushHabilitado({ flag: "on", publicKey: "public", privateKey: "private" })
    ).toBe(false);
    expect(
      parsePushHabilitado({
        flag: "off",
        publicKey: "public",
        privateKey: "private",
        subject: "mailto:admin@example.com",
      })
    ).toBe(false);
    expect(
      parsePushHabilitado({
        flag: "on",
        publicKey: "public",
        privateKey: "private",
        subject: "not-a-vapid-subject",
      })
    ).toBe(false);
  });

  it("se encienden solo con bandera explícita y configuración completa", () => {
    expect(
      parsePushHabilitado({
        flag: " ON ",
        publicKey: "public",
        privateKey: "private",
        subject: "mailto:admin@example.com",
      })
    ).toBe(true);
  });

  it("el service worker nunca crea una caché de páginas o datos autenticados", () => {
    const worker = readFileSync(path.join(RAIZ, "public", "sw.js"), "utf8");
    expect(worker).not.toContain("caches.open");
    expect(worker).not.toContain("cache.add");
    expect(worker).toContain("showNotification");
    expect(worker).toContain('"/inbox"');
    expect(worker).toContain("client.visibilityState !== \"visible\"");
  });

  it("el aviso predeterminado no incluye el texto privado de los mensajes", () => {
    const push = readFileSync(
      path.join(RAIZ, "src", "server", "push", "service.ts"),
      "utf8"
    );
    expect(push).toContain("Tienes un mensaje nuevo en tu bandeja.");
    expect(push).not.toContain("message.text");
    expect(push).not.toContain("contact.phone");
  });
});
