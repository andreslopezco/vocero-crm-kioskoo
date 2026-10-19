import { withAuth } from "@/lib/api";
import { dropiOrdersEnabled } from "@/server/dropi/flag";
import { completeDropiAuthorization } from "@/server/dropi/mcp-client";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  if (!dropiOrdersEnabled()) return new Response("Integración deshabilitada", { status: 404 });
  const url = new URL(req.url);
  if (url.searchParams.has("error")) return Response.redirect(new URL(`/settings/dropi?error=oauth`, url));
  try {
    await completeDropiAuthorization(session.organizationId, session.userId, url.searchParams);
    return Response.redirect(new URL("/settings/dropi?connected=1", url));
  } catch (error) {
    console.error("[dropi] OAuth callback failed", error instanceof Error ? error.message : "unknown");
    return Response.redirect(new URL("/settings/dropi?error=oauth", url));
  }
});
