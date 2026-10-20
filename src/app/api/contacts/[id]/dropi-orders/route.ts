import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { dropiOrdersEnabled, dropiDisabledResponse } from "@/server/dropi/flag";
import { DropiLinkError, linkDropiOrderToContact, listDropiOrdersForContact, unlinkDropiOrderFromContact } from "@/server/dropi/linked-orders";
import { getContactById } from "@/server/contacts";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };
const orderSchema = z.object({ orderId: z.string().trim().min(1).max(100) });

function linkError(error: unknown) {
  if (!(error instanceof DropiLinkError)) return apiError(500, "dropi_link_failed", "No se pudo vincular el pedido.");
  const status = error.code === "contact_not_found" ? 404
    : error.code === "not_connected" ? 409
    : error.code === "already_linked" ? 409
    : error.code === "invalid_order_id" || error.code === "owner_mismatch" ? 422
    : error.code === "missing_fields" || error.code === "tool_unavailable" ? 503 : 502;
  return apiError(status, error.code, error.message);
}

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!dropiOrdersEnabled()) return dropiDisabledResponse();
  const { id } = await ctx.params;
  const contact = await getContactById(session.organizationId, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado.");
  return Response.json({ ...(await listDropiOrdersForContact(session.organizationId, id)), canLink: canConfigure(session.role) });
});

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  if (!dropiOrdersEnabled()) return dropiDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "No tienes permiso para vincular pedidos.");
  const parsed = await parseBody(req, orderSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = await ctx.params;
  try {
    const order = await linkDropiOrderToContact(session.organizationId, id, parsed.data.orderId);
    return Response.json({ order }, { status: 201 });
  } catch (error) {
    return linkError(error);
  }
});

export const DELETE = withAuth(async (session, req: Request, ctx: Params) => {
  if (!dropiOrdersEnabled()) return dropiDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "No tienes permiso para desvincular pedidos.");
  const parsed = await parseBody(req, orderSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = await ctx.params;
  await unlinkDropiOrderFromContact(session.organizationId, id, parsed.data.orderId);
  return Response.json({ unlinked: true });
});
