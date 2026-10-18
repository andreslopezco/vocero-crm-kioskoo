"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, PackageSearch, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";

type Product = {
  retailerId: string;
  name: string;
  description: string | null;
  availability: string | null;
  price: string | null;
  currency: string | null;
  brand: string | null;
  imageUrl: string | null;
  url: string | null;
  attributes: Record<string, unknown>;
};

type Catalog = { catalogId: string; name: string | null; syncedAt: string; productCount: number; inStockCount: number };
type CatalogResponse = { catalog: Catalog | null; products: Product[] };

function showValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  try { return JSON.stringify(value); } catch { return ""; }
}

export function CatalogPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/settings/catalog?products=1", { cache: "no-store" });
      const data = await response.json() as CatalogResponse & { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "No se pudo cargar el catálogo.");
      setCatalog(data.catalog);
      setProducts(data.products ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sin conexión con el servidor.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/catalog", { method: "POST" });
      const data = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "No se pudo sincronizar el catálogo.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo sincronizar el catálogo.");
    } finally {
      setSyncing(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return products;
    return products.filter((product) => [
      product.retailerId, product.name, product.description, product.brand,
      product.availability, product.price, product.currency,
      ...Object.entries(product.attributes).flatMap(([key, value]) => [key, showValue(value)]),
    ].some((value) => value?.toLocaleLowerCase().includes(needle)));
  }, [products, query]);

  if (!loaded) return <p className="p-4 text-sm text-muted-foreground sm:p-6">Cargando catálogo…</p>;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-tight">Catálogo</h2>
          <p className="text-xs text-text-3">Productos del catálogo de Meta vinculado a WhatsApp.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
          {catalog && <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full pl-8" placeholder="Buscar producto…" aria-label="Buscar productos" />
          </div>}
          <Button size="sm" variant="secondary" disabled={syncing} onClick={() => void sync()}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando…" : "Sincronizar"}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-6">
        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

        {catalog ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border bg-subtle px-3 py-2.5 sm:px-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{catalog.name ?? `Catálogo ${catalog.catalogId}`}</p>
                <p className="text-xs text-muted-foreground">
                  {catalog.inStockCount} {catalog.inStockCount === 1 ? "producto disponible" : "productos disponibles"} · {catalog.productCount} {catalog.productCount === 1 ? "producto" : "productos"} en total
                </p>
              </div>
              <p className="text-xs text-text-3">Sincronizado {new Date(catalog.syncedAt).toLocaleString()}</p>
            </div>

            {filtered.length ? (
              <ul className="space-y-2">
                {filtered.map((product) => {
                  const attributes = Object.entries(product.attributes).filter(([, value]) => value != null && showValue(value) !== "");
                  return <li key={product.retailerId} className="rounded-lg border bg-card px-3 py-3 sm:px-4">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap sm:gap-x-4">
                      <div className="min-w-[60%] flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{product.name}</span>
                          <Badge variant={product.availability === "in stock" ? "success" : "secondary"}>
                            {product.availability === "in stock" ? "Disponible" : product.availability ?? "Disponibilidad no informada"}
                          </Badge>
                          {product.brand && <Badge variant="outline">{product.brand}</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">ID de producto: {product.retailerId}</p>
                      </div>
                      {product.price && <p className="shrink-0 text-sm font-semibold">{product.price}{product.currency ? ` ${product.currency}` : ""}</p>}
                    </div>
                    {product.description && <p className="mt-3 whitespace-pre-wrap text-sm text-text-2">{product.description}</p>}
                    {(attributes.length > 0 || product.url || product.imageUrl) && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-2.5">
                      {attributes.length > 0 && <details className="min-w-0 flex-1">
                        <summary className="w-fit cursor-pointer text-xs font-semibold text-text-2">Más información ({attributes.length})</summary>
                        <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                          {attributes.map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-2 text-xs">
                            <dt className="break-words text-muted-foreground">{key.replaceAll("_", " ")}</dt>
                            <dd className="break-words">{showValue(value)}</dd>
                          </div>)}
                        </dl>
                      </details>}
                      {product.imageUrl && <a href={product.imageUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand hover:underline">Ver imagen</a>}
                      {product.url && <a href={product.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand hover:underline">Abrir en tienda</a>}
                    </div>}
                  </li>;
                })}
              </ul>
            ) : (
              <EmptyState
                icon={query ? Search : PackageSearch}
                title={products.length ? "Sin resultados" : "El catálogo no contiene productos"}
                description={products.length ? `No encontramos productos que coincidan con «${query.trim()}».` : "Cuando haya productos publicados en Meta, aparecerán aquí."}
                className="min-h-48 rounded-lg border border-dashed"
              />
            )}
            <p className="text-xs text-text-3">La disponibilidad refleja el último estado publicado en Meta; no reserva inventario.</p>
          </>
        ) : (
          <EmptyState
            icon={PackageSearch}
            title="Todavía no hay un catálogo sincronizado"
            description="Conecta WhatsApp y asegúrate de que el token tenga permiso de lectura del catálogo de Meta. Después selecciona «Sincronizar»."
            className="h-full min-h-64"
          />
        )}
      </div>
    </div>
  );
}
