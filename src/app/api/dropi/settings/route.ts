import { withAuth, apiError, parseBody } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { dropiOrdersEnabled, dropiDisabledResponse } from "@/server/dropi/flag";
import { dropiConfigStatus } from "@/server/dropi/config";
import { getDropiConnection, removeDropiConnection, updateDropiSettings } from "@/server/dropi/credentials";
import { z } from "zod";

export const dynamic = "force-dynamic";
const settingsSchema = z.object({
  rateType: z.enum(["CON RECAUDO", "SIN RECAUDO"]).nullable(),
  orderCreationEnabled: z.boolean(),
});

export const GET = withAuth(async (session) => {
  if (!dropiOrdersEnabled()) return dropiDisabledResponse();
  const row = await getDropiConnection(session.organizationId);
  return Response.json({
    config: dropiConfigStatus(),
    connected: Boolean(row),
    status: row?.status ?? "disconnected",
    lastError: row?.lastError ?? null,
    rateType: row?.rateType ?? null,
    orderCreationEnabled: row?.orderCreationEnabled ?? false,
    tools: row?.bundle.tools?.map((tool) => tool.name) ?? [],
  });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!dropiOrdersEnabled()) return dropiDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "No tienes permiso para cambiar los ajustes de Dropi.");
  const parsed = await parseBody(req, settingsSchema);
  if (!parsed.ok) return parsed.response;
  const row = await getDropiConnection(session.organizationId);
  if (!row) return apiError(409, "dropi_not_connected", "Conecta Dropi antes de guardar estos ajustes.");
  await updateDropiSettings(session.organizationId, parsed.data);
  return Response.json({ saved: true, orderCreationEnabled: parsed.data.orderCreationEnabled });
});

export const DELETE = withAuth(async (session) => {
  if (!dropiOrdersEnabled()) return dropiDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "No tienes permiso para desconectar Dropi.");
  await removeDropiConnection(session.organizationId);
  return Response.json({ disconnected: true });
});
