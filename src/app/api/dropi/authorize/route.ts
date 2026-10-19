import { withAuth, apiError } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { dropiOrdersEnabled, dropiDisabledResponse } from "@/server/dropi/flag";
import { beginDropiAuthorization } from "@/server/dropi/mcp-client";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session) => {
  if (!dropiOrdersEnabled()) return dropiDisabledResponse();
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Solo un administrador puede conectar Dropi.");
  const result = await beginDropiAuthorization(session.organizationId, session.userId);
  if (result.connected) return Response.json({ connected: true });
  if (!result.authorizationUrl || new URL(result.authorizationUrl).origin !== "https://oauth.dropi.co") {
    return apiError(502, "dropi_oauth", "Dropi devolvió una dirección de autorización inválida.");
  }
  return Response.json({ authorizationUrl: result.authorizationUrl });
});
