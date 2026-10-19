import { parseBody, withAuth } from "@/lib/api";
import { catalogDisabledResponse, catalogEnabled } from "@/server/catalog/flag";
import { catalogProductMutationSchema } from "@/server/catalog/input";
import { CatalogError, saveCatalogProduct, type CatalogProductMutation } from "@/server/catalog/service";

export const dynamic = "force-dynamic";

function errorStatus(err: CatalogError): number {
  if (err.code === "not_connected" || err.code === "no_catalog" || err.code === "product_exists") return 409;
  if (err.code === "product_not_found") return 404;
  if (err.code === "meta_unavailable") return 503;
  return 422;
}

async function mutateProduct(
  session: { organizationId: string },
  req: Request,
  mode: "create" | "update"
): Promise<Response> {
  if (!catalogEnabled()) return catalogDisabledResponse();
  const parsed = await parseBody(req, catalogProductMutationSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const result = await saveCatalogProduct(
      session.organizationId,
      parsed.data as CatalogProductMutation,
      mode
    );
    return Response.json({ ok: true, synced: result.synced, imageSyncFailed: result.imageSyncFailed ?? false });
  } catch (err) {
    if (err instanceof CatalogError) {
      return Response.json({ error: { code: err.code, message: err.message } }, { status: errorStatus(err) });
    }
    throw err;
  }
}

export const POST = withAuth((session, req: Request) => mutateProduct(session, req, "create"));
export const PUT = withAuth((session, req: Request) => mutateProduct(session, req, "update"));
