import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { renderKb } from "@/server/ai/prompts";
import { buildHumanSuggestionMessages } from "@/server/ai/suggestion";
import { getConversation } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const suggestionSchema = z.object({
  suggestion: z.string().trim().min(1).max(6000),
});

const requestSchema = z.object({
  draft: z.string().max(4000).optional(),
});

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, requestSchema);
  if (!body.ok) return body.response;

  const conversation = await getConversation(session.organizationId, id);
  if (!conversation || conversation.conversation.isTest) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }

  const db = getDb();
  const history = await db
    .select({ direction: schema.message.direction, type: schema.message.type, text: schema.message.text })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        session.organizationId,
        eq(schema.message.conversationId, id)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(30);
  history.reverse();
  const latestCustomerMessage = [...history].reverse().find((message) => message.direction === "in");
  if (!latestCustomerMessage) {
    return apiError(409, "no_customer_message", "Aún no hay un mensaje del cliente para responder");
  }

  const [profiles, knowledge, operators] = await Promise.all([
    db
      .select()
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, session.organizationId))
      .limit(1),
    db
      .select()
      .from(schema.kbEntry)
      .where(scoped(schema.kbEntry.organizationId, session.organizationId))
      .orderBy(asc(schema.kbEntry.createdAt)),
    db
      .select({ name: schema.user.name })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
      .where(
        scoped(
          schema.member.organizationId,
          session.organizationId,
          eq(schema.member.userId, session.userId)
        )
      )
      .limit(1),
  ]);

  const profile = profiles[0];
  const operatorName = operators[0]?.name?.trim() || "agente del equipo";
  const transcript = history
    .slice(-24)
    .map((message) => {
      const role = message.direction === "in" ? "CLIENTE" : "AGENTE";
      const content = message.text?.trim() || `[mensaje de tipo ${message.type}]`;
      return `${role}: ${content.slice(0, 1200)}`;
    })
    .join("\n");

  const messages = buildHumanSuggestionMessages({
    operatorName,
    agentName: profile?.name ?? "",
    tone: profile?.tone ?? null,
    instructions: profile?.instructions ?? null,
    knowledge: renderKb(knowledge),
    channel: conversation.conversation.channel,
    contactName: conversation.contact.name,
    transcript,
    draft: body.data.draft,
  });

  const result = await chatJson(suggestionSchema, messages, {
    organizationId: session.organizationId,
  });
  if (!result.ok) {
    if (result.error === "not_configured") {
      return apiError(503, "ai_unavailable", "La IA no está configurada. Revísala en Ajustes → IA.");
    }
    return apiError(502, "suggestion_failed", "No se pudo generar la sugerencia. Inténtalo de nuevo.");
  }

  return Response.json({ suggestion: result.data.suggestion });
});
