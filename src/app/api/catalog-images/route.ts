import { readMediaFile } from "@/server/whatsapp/media";
import { verifyCatalogImageSignature } from "@/server/catalog/images";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const organizationId = params.get("org") ?? "";
  const assetId = params.get("asset") ?? "";
  if (!/^[\w.-]{1,64}$/.test(organizationId) || !/^[\w.-]{1,96}\.(?:jpg|png)$/.test(assetId)) {
    return new Response(null, { status: 404 });
  }
  if (!verifyCatalogImageSignature(organizationId, assetId, params.get("sig"))) {
    return new Response(null, { status: 404 });
  }
  try {
    const bytes = await readMediaFile(organizationId, assetId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": assetId.endsWith(".png") ? "image/png" : "image/jpeg",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
