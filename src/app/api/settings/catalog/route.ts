import { withAuth } from "@/lib/api";
import { catalogDisabledResponse, catalogEnabled } from "@/server/catalog/flag";
import { CatalogError, getCatalogSnapshot, syncCatalog } from "@/server/catalog/service";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  if (!catalogEnabled()) return catalogDisabledResponse();
  const snapshot = await getCatalogSnapshot(session.organizationId);
  return Response.json({
    catalog: snapshot ? {
      catalogId: snapshot.catalogId,
      name: snapshot.catalogName,
      syncedAt: snapshot.syncedAt.toISOString(),
      productCount: snapshot.products.length,
      inStockCount: snapshot.products.filter((p) => p.availability === "in stock").length,
    } : null,
    ...(snapshot && new URL(req.url).searchParams.get("products") === "1" ? {
      products: snapshot.products.map(({ retailerId, name, description, availability, price, currency, brand, imageUrl, url, attributes }) => ({
        retailerId, name, description, availability, price, currency, brand, imageUrl, url, attributes,
      })),
    } : {}),
  });
});

export const POST = withAuth(async (session) => {
  if (!catalogEnabled()) return catalogDisabledResponse();
  try {
    const snapshot = await syncCatalog(session.organizationId, { force: true });
    return Response.json({
      catalog: {
        catalogId: snapshot.catalogId,
        name: snapshot.catalogName,
        syncedAt: snapshot.syncedAt.toISOString(),
        productCount: snapshot.products.length,
        inStockCount: snapshot.products.filter((p) => p.availability === "in stock").length,
      },
    });
  } catch (err) {
    if (err instanceof CatalogError) {
      const status = err.code === "not_connected" ? 409 : err.code === "meta_unavailable" ? 503 : 422;
      return Response.json({ error: { code: err.code, message: err.message } }, { status });
    }
    throw err;
  }
});
