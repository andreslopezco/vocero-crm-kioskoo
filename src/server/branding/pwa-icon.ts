import { createElement } from "react";
import { ImageResponse } from "next/og";
import { APP_ICON_ASSET } from "@/lib/favicon";
import { getBrandingContext } from "@/server/branding";
import { readMediaFile } from "@/server/whatsapp/media";
import { GET as getFallbackIcon } from "@/app/api/branding/app-icon/route";

/** Iconos cuadrados y opacos con los píxeles exactos anunciados al sistema. */
export async function renderPwaIcon(size: 180 | 192 | 512): Promise<Response> {
  const ctx = await getBrandingContext().catch(() => null);
  let bytes: Uint8Array | null = null;
  if (ctx?.organizationId && ctx.branding.appIcon) {
    try {
      bytes = await readMediaFile(ctx.organizationId, APP_ICON_ASSET);
    } catch {
      // Si se perdió el archivo de marca, usamos el icono generado.
    }
  }
  if (!bytes) {
    const fallback = await getFallbackIcon(new Request("https://localhost/api/branding/app-icon"));
    bytes = new Uint8Array(await fallback.arrayBuffer());
  }

  const innerSize = Math.round(size * 0.82);
  const src = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
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
          backgroundColor: "#070e20",
        },
      },
      createElement("img", {
        src,
        width: innerSize,
        height: innerSize,
        style: { width: innerSize, height: innerSize, objectFit: "contain" },
      })
    ),
    {
      width: size,
      height: size,
      headers: {
        "cache-control": "no-cache, must-revalidate",
        "x-content-type-options": "nosniff",
      },
    }
  );
}
