import { rm } from "node:fs/promises";
import { apiError, withAuth } from "@/lib/api";
import {
  FAVICON_MIMES,
  MAX_FAVICON_BYTES,
  TAB_ICON_ASSET,
  sniffFaviconMime,
} from "@/lib/favicon";
import { getBranding, saveBranding } from "@/server/branding";
import { mediaFilePath, saveMediaFile } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

export const PUT = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede cambiar la marca");
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return apiError(422, "empty", "No llegó ningún archivo");
  if (bytes.length > MAX_FAVICON_BYTES) {
    return apiError(413, "too_large", `El favicon no puede pasar de ${Math.round(MAX_FAVICON_BYTES / 1024)} KB`);
  }
  const mime = sniffFaviconMime(bytes);
  if (!mime || !FAVICON_MIMES.includes(mime)) {
    return apiError(422, "unsupported", "Formato no reconocido. Usa PNG, SVG, ICO, JPEG o WebP.");
  }
  await saveMediaFile(session.organizationId, TAB_ICON_ASSET, bytes);
  const branding = await getBranding(session.organizationId);
  const version = Date.now();
  await saveBranding(session.organizationId, { ...branding, tabIcon: { mime, version } });
  return Response.json({ tabIcon: { mime, version } });
});

export const DELETE = withAuth(async (session) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede cambiar la marca");
  }
  const branding = await getBranding(session.organizationId);
  await saveBranding(session.organizationId, { ...branding, tabIcon: null });
  await rm(mediaFilePath(session.organizationId, TAB_ICON_ASSET), { force: true }).catch(() => null);
  return Response.json({ tabIcon: null });
});
