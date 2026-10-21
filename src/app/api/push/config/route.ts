import { apiError, withAuth } from "@/lib/api";
import { clavePublicaPush, pushHabilitado } from "@/server/push/flag";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  if (!pushHabilitado()) return apiError(404, "not_found", "No encontrado");
  return Response.json({ enabled: true, publicKey: clavePublicaPush() });
});
