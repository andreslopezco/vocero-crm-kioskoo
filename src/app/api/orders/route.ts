import { apiError, withAuth } from "@/lib/api";
import { dropiOrdersEnabled, dropiDisabledResponse } from "@/server/dropi/flag";
import { DropiLinkError, listDropiOrders, refreshDropiOrders } from "@/server/dropi/linked-orders";

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
