import { readMediaFile } from "@/server/whatsapp/media";
import { getBrandingContext } from "@/server/branding";
import { APP_ICON_ASSET } from "@/lib/favicon";

export const dynamic = "force-dynamic";

/** Ruta pública: la solicita el navegador antes de tener una sesión PWA. */
export async function GET(req: Request) {
  const cacheable = new URL(req.url).searchParams.has("v");
  const ctx = await getBrandingContext().catch(() => null);
  if (!ctx?.organizationId || !ctx.branding.appIcon) {
    return new Response("Icono no configurado", { status: 404 });
  }
  try {
    const bytes = await readMediaFile(ctx.organizationId, APP_ICON_ASSET);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/png",
        "x-content-type-options": "nosniff",
        "cache-control": cacheable ? "public, max-age=31536000, immutable" : "public, max-age=60",
      },
    });
  } catch {
    return new Response("Icono no disponible", { status: 404 });
  }
}
