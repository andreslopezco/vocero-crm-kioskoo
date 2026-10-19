import { describe, expect, it } from "vitest";
import { buildHumanSuggestionMessages } from "@/server/ai/suggestion";

describe("redacción de sugerencias para el agente humano", () => {
  const messages = buildHumanSuggestionMessages({
    operatorName: "Andrés López",
    agentName: "Kiara",
    tone: "Cálido y directo",
    instructions: "Pregunta primero por el presupuesto.",
    knowledge: "Envíos en 2 días hábiles.",
    channel: "instagram",
    contactName: "María",
    transcript: "CLIENTE: ¿Cuánto tarda el envío?",
  });

  it("mantiene la identidad humana del usuario y no la del bot", () => {
    const system = messages[0]?.content ?? "";
    expect(system).toContain("Andrés López");
    expect(system).toContain("no te presentes como IA, bot, asistente virtual");
    expect(system).toContain("Kiara");
  });

  it("incluye el canal, las instrucciones, el conocimiento y la conversación", () => {
    expect(messages[0]?.content).toContain("Instagram");
    expect(messages[0]?.content).toContain("Pregunta primero por el presupuesto");
    expect(messages[0]?.content).toContain("Envíos en 2 días hábiles");
    expect(messages[1]?.content).toContain("CLIENTE: ¿Cuánto tarda el envío?");
  });

  it("usa el borrador previo como punto de partida cuando existe", () => {
    const [system, user] = buildHumanSuggestionMessages({
      operatorName: "Alexandra Pérez",
      agentName: "Kiara",
      tone: null,
      instructions: null,
      knowledge: "(knowledge base vacío)",
      channel: "whatsapp",
      contactName: "María",
      transcript: "CLIENTE: Hola",
      draft: "Hola María, lo reviso.",
    });
    expect(system?.content).toContain("Alexandra Pérez");
    expect(user?.content).toContain("Hola María, lo reviso.");
    expect(user?.content).toContain("Mejóralo conservando su intención");
  });
});
