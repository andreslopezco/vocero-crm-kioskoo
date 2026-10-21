import { createElement } from "react";
import { ImageResponse } from "next/og";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { APP_ICON_ASSET } from "@/lib/favicon";
import { getBrandingContext } from "@/server/branding";
import { readMediaFile } from "@/server/whatsapp/media";
import { GET as getAppIcon } from "@/app/api/branding/app-icon/route";

// Safari/iOS busca este nombre canónico al crear «Agregar a inicio».
export const dynamic = "force-dynamic";
const iconSize = { width: 180, height: 180 };

export async function GET() {
  const ctx = await getBrandingContext().catch(() => null);
  const branding = ctx?.branding ?? DEFAULT_BRANDING;
  if (ctx?.organizationId && branding.appIcon) {
    try {
      const bytes = await readMediaFile(ctx.organizationId, APP_ICON_ASSET);
      const src = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
      return new ImageResponse(
        createElement("img", {
          src,
          width: 180,
          height: 180,
          style: { width: 180, height: 180, objectFit: "contain" },
        }),
        {
          ...iconSize,
          headers: {
            "cache-control": "no-cache, must-revalidate",
            "x-content-type-options": "nosniff",
          },
        }
      );
    } catch {
      // El icono predeterminado evita dejar una ruta rota si falta el archivo.
    }
  }
  return getAppIcon(new Request("https://localhost/api/branding/app-icon"));
}
