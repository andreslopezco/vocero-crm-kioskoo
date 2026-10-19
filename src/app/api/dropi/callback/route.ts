import { withAuth } from "@/lib/api";
import { dropiOrdersEnabled } from "@/server/dropi/flag";
import { dropiConfig } from "@/server/dropi/config";
import { completeDropiAuthorization } from "@/server/dropi/mcp-client";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  if (!dropiOrdersEnabled()) return new Response("Integración deshabilitada", { status: 404 });
  const url = new URL(req.url);
  const settingsUrl = new URL("/settings/dropi", dropiConfig().callbackUrl);
  if (url.searchParams.has("error")) {
    settingsUrl.searchParams.set("error", "oauth");
    return Response.redirect(settingsUrl);
  }
  try {
    await completeDropiAuthorization(session.organizationId, session.userId, url.searchParams);
    settingsUrl.searchParams.set("connected", "1");
    return Response.redirect(settingsUrl);
  } catch (error) {
    console.error("[dropi] OAuth callback failed", error instanceof Error ? error.message : "unknown");
    settingsUrl.searchParams.set("error", "oauth");
    return Response.redirect(settingsUrl);
  }
});
