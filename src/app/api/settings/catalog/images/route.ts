import { withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { newId } from "@/lib/db/ids";
import { catalogEnabled } from "@/server/catalog/flag";
import { catalogImageUrl, CatalogImageError, validateCatalogImage } from "@/server/catalog/images";
import { saveMediaFile } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, request: Request) => {
  if (!catalogEnabled()) return Response.json({ error: { message: "La función de catálogo está desactivada." } }, { status: 404 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8 * 1024 * 1024 + 128 * 1024) {
    return Response.json({ error: { message: "Cada imagen debe pesar como máximo 8 MB." } }, { status: 413 });
  }
  let formData: FormData;
  try { formData = await request.formData(); } catch {
    return Response.json({ error: { message: "No se pudo leer el archivo enviado." } }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: { message: "Selecciona una imagen JPEG o PNG." } }, { status: 422 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return Response.json({ error: { message: "Cada imagen debe pesar como máximo 8 MB." } }, { status: 413 });
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = validateCatalogImage(bytes, file.type);
    const baseUrl = new URL(getEnv().APP_BASE_URL);
    if (baseUrl.protocol !== "https:" && getEnv().NODE_ENV === "production") {
      return Response.json({ error: { message: "La URL pública del sitio debe usar HTTPS para que Meta pueda leer las imágenes." } }, { status: 503 });
    }
    const assetId = `${newId("mediaAsset")}.${image.extension}`;
    await saveMediaFile(session.organizationId, assetId, bytes);
    return Response.json({
      url: catalogImageUrl(session.organizationId, assetId),
      width: image.width,
      height: image.height,
      mimeType: image.mimeType,
    });
  } catch (err) {
    if (err instanceof CatalogImageError) {
      return Response.json({ error: { message: err.message } }, { status: 422 });
    }
    throw err;
  }
});
