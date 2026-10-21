import { createElement } from "react";
import { ImageResponse } from "next/og";
import { DEFAULT_BRANDING } from "@/lib/branding";
import {
  BRAND_CYAN_ON_TILE,
  BRAND_MARK_BODY,
  BRAND_MARK_STROKE,
  BRAND_MARK_TAIL,
  isVoceroName,
} from "@/lib/brand";
import { faviconInitial } from "@/lib/favicon";
import { readMediaFile } from "@/server/whatsapp/media";
import { getBrandingContext } from "@/server/branding";
import { APP_ICON_ASSET } from "@/lib/favicon";

export const dynamic = "force-dynamic";
const size = { width: 180, height: 180 };

function iconoGenerado(name: string, accent: string) {
  return new ImageResponse(
    createElement(
      "div",
      {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(145deg, ${accent}, #083dc0)`,
          borderRadius: 40,
          color: "white",
          fontSize: 116,
          fontWeight: 800,
          letterSpacing: -8,
        },
      },
      isVoceroName(name)
        ? createElement(
            "svg",
            { viewBox: "0 0 24 24", width: "112", height: "112" },
            createElement("path", {
              d: BRAND_MARK_BODY,
              stroke: "white",
              strokeWidth: BRAND_MARK_STROKE,
              strokeLinecap: "round",
              fill: "none",
            }),
            createElement("path", {
              d: BRAND_MARK_TAIL,
              stroke: BRAND_CYAN_ON_TILE,
              strokeWidth: BRAND_MARK_STROKE,
              strokeLinecap: "round",
              fill: "none",
            })
          )
        : faviconInitial(name)
    ),
    size
  );
}

/** Ruta pública: la solicita el navegador antes de tener una sesión PWA. */
export async function GET(req: Request) {
  const cacheable = new URL(req.url).searchParams.has("v");
  const ctx = await getBrandingContext().catch(() => null);
  const branding = ctx?.branding ?? DEFAULT_BRANDING;
  if (ctx?.organizationId && branding.appIcon) {
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
      // Si se perdió el archivo subido, el icono generado evita dejar una URL rota.
    }
  }
  return iconoGenerado(branding.name, branding.accent);
}
