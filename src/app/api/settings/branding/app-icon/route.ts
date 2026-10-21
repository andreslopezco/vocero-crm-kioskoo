import { rm } from "node:fs/promises";
import { apiError, withAuth } from "@/lib/api";
import { APP_ICON_ASSET } from "@/lib/favicon";
import { getBranding, saveBranding } from "@/server/branding";
import { mediaFilePath, saveMediaFile } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

const MAX_APP_ICON_BYTES = 1024 * 1024;

function isSquarePng(bytes: Uint8Array): boolean {
  const isPng =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (!isPng || bytes.length < 24) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width === height && width >= 512 && width <= 2048;
}

/** Icono PNG independiente para el acceso directo Android/iOS. */
export const PUT = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede cambiar la marca");
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return apiError(422, "empty", "No llegó ningún archivo");
  if (bytes.length > MAX_APP_ICON_BYTES) {
    return apiError(413, "too_large", "El icono no puede pasar de 1 MB");
  }
  if (!isSquarePng(bytes)) {
    return apiError(422, "invalid_icon", "Usa un PNG cuadrado de entre 512 y 2048 px.");
  }

  await saveMediaFile(session.organizationId, APP_ICON_ASSET, bytes);
  const branding = await getBranding(session.organizationId);
  const version = Date.now();
  await saveBranding(session.organizationId, {
    ...branding,
    appIcon: { mime: "image/png", version },
  });
  return Response.json({ appIcon: { mime: "image/png", version } });
});

export const DELETE = withAuth(async (session) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede cambiar la marca");
  }
  const branding = await getBranding(session.organizationId);
  await saveBranding(session.organizationId, { ...branding, appIcon: null });
  await rm(mediaFilePath(session.organizationId, APP_ICON_ASSET), { force: true }).catch(() => null);
  return Response.json({ appIcon: null });
});
