import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { pushHabilitado } from "@/server/push/flag";
import {
  guardarSuscripcion,
  revocarSuscripcion,
  type SuscripcionWebPush,
} from "@/server/push/service";

export const dynamic = "force-dynamic";

const endpoint = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const proveedorPermitido =
      host === "fcm.googleapis.com" ||
      host === "web.push.apple.com" ||
      host === "push.services.mozilla.com" ||
      host.endsWith(".push.services.mozilla.com") ||
      host.endsWith(".notify.windows.com");
    return parsed.protocol === "https:" && !parsed.port && proveedorPermitido;
  }, "El endpoint debe pertenecer a un servicio Web Push compatible");

const suscripcionSchema = z.object({
  endpoint,
  expirationTime: z.number().int().positive().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(16).max(256),
    auth: z.string().min(8).max(128),
  }),
});

const revocacionSchema = z.object({ endpoint });

function permitido(orgId: string, userId: string): boolean {
  return checkRateLimit(`push:${orgId}:${userId}`, {
    windowMs: 60_000,
    max: 10,
  }).allowed;
}

export const POST = withAuth(async (session, req: Request) => {
  if (!pushHabilitado()) return apiError(404, "not_found", "No encontrado");
  if (!permitido(session.organizationId, session.userId)) {
    return apiError(429, "rate_limited", "Espera un momento antes de intentarlo otra vez");
  }
  const body = await parseBody(req, suscripcionSchema);
  if (!body.ok) return body.response;
  await guardarSuscripcion({
    organizationId: session.organizationId,
    userId: session.userId,
    suscripcion: body.data as SuscripcionWebPush,
  });
  return Response.json({ saved: true }, { status: 201 });
});

export const DELETE = withAuth(async (session, req: Request) => {
  if (!pushHabilitado()) return apiError(404, "not_found", "No encontrado");
  if (!permitido(session.organizationId, session.userId)) {
    return apiError(429, "rate_limited", "Espera un momento antes de intentarlo otra vez");
  }
  const body = await parseBody(req, revocacionSchema);
  if (!body.ok) return body.response;
  await revocarSuscripcion({
    organizationId: session.organizationId,
    userId: session.userId,
    endpoint: body.data.endpoint,
  });
  return Response.json({ removed: true });
});
