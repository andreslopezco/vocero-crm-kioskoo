import { apiError, withAuth } from "@/lib/api";
import { dropiOrdersEnabled, dropiDisabledResponse } from "@/server/dropi/flag";
import { assignDropiOrderToContact, dismissDropiOrder, DropiLinkError, listDropiOrders, refreshDropiOrders, restoreDropiOrder } from "@/server/dropi/linked-orders";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  if (!dropiOrdersEnabled()) return dropiDisabledResponse();
  try {
    return Response.json(await listDropiOrders(session.organizationId));
  } catch (error) {
    console.error("[orders] list failed", error instanceof Error ? error.message : "unknown");
    return apiError(500, "orders_unavailable", "No se pudieron cargar los pedidos.");
  }
});

export const POST = withAuth(async (session) => {
  if (!dropiOrdersEnabled()) return dropiDisabledResponse();
  try {
    return Response.json(await refreshDropiOrders(session.organizationId));
  } catch (error) {
    console.error("[orders] refresh failed", error instanceof Error ? error.message : "unknown");
    const message = error instanceof DropiLinkError
      ? error.message
      : "Dropi no pudo actualizar los pedidos. Inténtalo de nuevo más tarde.";
    return apiError(502, "orders_refresh_failed", message);
  }
});

export const DELETE = withAuth(async (session, request: Request) => {
  if (!dropiOrdersEnabled()) return dropiDisabledResponse();
  try {
    const body = await request.json().catch(() => null) as { orderId?: unknown } | null;
    if (!body || typeof body.orderId !== "string") {
      return apiError(422, "invalid_order_id", "El ID del pedido es obligatorio.");
    }
    await dismissDropiOrder(session.organizationId, body.orderId);
    return Response.json({ dismissed: true });
  } catch (error) {
    console.error("[orders] dismiss failed", error instanceof Error ? error.message : "unknown");
    const message = error instanceof DropiLinkError ? error.message : "No se pudo eliminar el pedido de Vocero.";
    return apiError(422, "order_dismiss_failed", message);
  }
});

export const PUT = withAuth(async (session, request: Request) => {
  if (!dropiOrdersEnabled()) return dropiDisabledResponse();
  try {
    const body = await request.json().catch(() => null) as { orderId?: unknown } | null;
    if (!body || typeof body.orderId !== "string") {
      return apiError(422, "invalid_order_id", "El ID del pedido es obligatorio.");
    }
    await restoreDropiOrder(session.organizationId, body.orderId);
    return Response.json({ restored: true });
  } catch (error) {
    console.error("[orders] restore failed", error instanceof Error ? error.message : "unknown");
    const message = error instanceof DropiLinkError ? error.message : "No se pudo restaurar el pedido.";
    return apiError(422, "order_restore_failed", message);
  }
});

export const PATCH = withAuth(async (session, request: Request) => {
  if (!dropiOrdersEnabled()) return dropiDisabledResponse();
  try {
    const body = await request.json().catch(() => null) as { orderId?: unknown; contactId?: unknown } | null;
    if (!body || typeof body.orderId !== "string" || typeof body.contactId !== "string") {
      return apiError(422, "invalid_assignment", "El pedido y el contacto son obligatorios.");
    }
    await assignDropiOrderToContact(session.organizationId, body.orderId, body.contactId);
    return Response.json({ assigned: true });
  } catch (error) {
    console.error("[orders] contact assignment failed", error instanceof Error ? error.message : "unknown");
    const message = error instanceof DropiLinkError ? error.message : "No se pudo asignar el pedido al contacto.";
    return apiError(422, "order_assignment_failed", message);
  }
});
