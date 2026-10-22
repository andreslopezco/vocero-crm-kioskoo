import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  purchaseCustomData,
  toConversionActivityRow,
} from "@/server/attribution/conversions";

/**
 * 016 — Las piezas puras del reporte de conversiones y dos guardarraíles que
 * se leen del código fuente porque afirman AUSENCIA (que algo no se llama),
 * y eso no se observa desde fuera.
 */

describe("purchaseCustomData", () => {
  it("convierte centavos a unidades y normaliza la moneda", () => {
    expect(purchaseCustomData({ amountCents: 45050, currency: "mxn" })).toEqual({
      value: 450.5,
      currency: "MXN",
    });
  });

  it("no construye un Purchase si falta monto o moneda válidos", () => {
    expect(purchaseCustomData({ amountCents: null, currency: "MXN" })).toBeNull();
    expect(purchaseCustomData({ amountCents: 0, currency: "MXN" })).toBeNull();
    expect(purchaseCustomData({ amountCents: -100, currency: "MXN" })).toBeNull();
    expect(purchaseCustomData({ amountCents: 12300, currency: null })).toBeNull();
    expect(purchaseCustomData({ amountCents: 12300, currency: "PESO" })).toBeNull();
  });
});

describe("toConversionActivityRow", () => {
  const base = {
    id: "cve_1",
    conversationId: "cv_1",
    eventName: "QualifiedLead",
    error: null,
    fbTraceId: "Aki1",
    contactName: "Marina",
    adHeadline: "Kit de verano",
    createdAt: new Date("2026-08-28T10:00:00.000Z"),
  };

  it("muestra el momento del ENVÍO cuando lo hubo", () => {
    const row = toConversionActivityRow({
      ...base,
      status: "sent",
      sentAt: new Date("2026-08-28T10:05:00.000Z"),
    });
    expect(row.at).toBe("2026-08-28T10:05:00.000Z");
    expect(row.adHeadline).toBe("Kit de verano");
  });

  it("y el de creación cuando no salió", () => {
    const row = toConversionActivityRow({
      ...base,
      status: "skipped",
      sentAt: null,
      error: "sin ctwa_clid",
    });
    expect(row.at).toBe("2026-08-28T10:00:00.000Z");
    // El motivo se conserva tal cual: es la respuesta a "¿por qué este lead no
    // aparece en Meta?".
    expect(row.error).toBe("sin ctwa_clid");
  });
});

describe("guardarraíles del reporte", () => {
  const source = readFileSync("src/server/attribution/conversions.ts", "utf8");

  it("una conversación de prueba jamás puede producir un evento", () => {
    // Mismo guardrail que el sender: el Laboratorio no toca el mundo real.
    expect(source).toContain("eq(schema.conversation.isTest, false)");
  });

  it("el dedup es el UNIQUE de la base, no un chequeo previo", () => {
    // A Meta no se le puede des-enviar una compra: dos movimientos simultáneos
    // del mismo lead tienen que chocar en la base, no en un `if`.
    expect(source).toContain("onConflictDoNothing");
  });

  it("la emisión cuelga de la puerta única de etapas", () => {
    const gate = readFileSync("src/server/leads/stage-history.ts", "utf8");
    expect(gate).toContain("reportStageChange");
    // Y ocurre DESPUÉS del commit: una llamada de red dentro de la transacción
    // la mantendría abierta mientras Meta piensa.
    const txEnd = gate.indexOf("  });");
    expect(gate.indexOf("reportStageChange(", txEnd)).toBeGreaterThan(txEnd);
  });
});
