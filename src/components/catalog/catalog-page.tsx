"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, PackageSearch, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  if (!loaded) return <p className="p-6 text-sm text-muted-foreground">Cargando catálogo…</p>;

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-brand"><PackageSearch className="h-5 w-5" aria-hidden /><span className="kicker">WhatsApp · Meta</span></div>
            <h1 className="text-2xl font-bold tracking-tight">Catálogo</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Productos sincronizados desde el catálogo vinculado al número de WhatsApp. Aquí puedes revisar los datos que usa el agente para recomendar productos.</p>
          </div>
          <Button variant="outline" disabled={syncing} onClick={() => void sync()}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando…" : "Sincronizar ahora"}
          </Button>
        </header>

        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

        {catalog ? (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>{catalog.name ?? `Catálogo ${catalog.catalogId}`}</CardTitle>
                <CardDescription>{catalog.inStockCount} disponibles según Meta · {catalog.productCount} productos en total · sincronizado {new Date(catalog.syncedAt).toLocaleString()}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Buscar por nombre, marca, material…" aria-label="Buscar productos" /></div>
                <p className="text-xs text-muted-foreground">La disponibilidad refleja el último estado publicado en Meta; no reserva inventario.</p>
              </CardContent>
            </Card>

            {filtered.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((product) => {
                  const attributes = Object.entries(product.attributes).filter(([, value]) => value != null && showValue(value) !== "");
                  return <Card key={product.retailerId} className="overflow-hidden">
                    {product.imageUrl && <a href={product.imageUrl} target="_blank" rel="noreferrer" className="block border-b px-5 py-2 text-xs text-brand hover:underline">Ver imagen del producto</a>}
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3"><CardTitle className="text-base">{product.name}</CardTitle><Badge variant={product.availability === "in stock" ? "success" : "secondary"}>{product.availability ?? "Disponibilidad no informada"}</Badge></div>
                      <CardDescription>ID de producto: {product.retailerId}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {product.price && <p className="text-lg font-semibold">{product.price}{product.currency ? ` ${product.currency}` : ""}</p>}
                      {product.brand && <p><span className="text-muted-foreground">Marca:</span> {product.brand}</p>}
                      {product.description && <p className="whitespace-pre-wrap text-muted-foreground">{product.description}</p>}
                      {attributes.length > 0 && <details className="border-t pt-3"><summary className="cursor-pointer text-sm font-medium">Más información ({attributes.length})</summary><dl className="mt-3 space-y-2">{attributes.map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-2 text-xs"><dt className="break-words text-muted-foreground">{key.replaceAll("_", " ")}</dt><dd className="break-words">{showValue(value)}</dd></div>)}</dl></details>}
                      {product.url && <a href={product.url} target="_blank" rel="noreferrer" className="inline-block text-xs text-brand hover:underline">Abrir producto en tienda</a>}
                    </CardContent>
                  </Card>;
                })}
              </div>
            ) : <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{products.length ? "No hay productos que coincidan con la búsqueda." : "El catálogo está sincronizado, pero no contiene productos."}</CardContent></Card>}
          </>
        ) : (
          <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-center"><PackageSearch className="h-9 w-9 text-muted-foreground" /><div><h2 className="font-semibold">Todavía no hay un catálogo sincronizado</h2><p className="mt-1 max-w-lg text-sm text-muted-foreground">Conecta WhatsApp y asegúrate de que el token tenga permiso de lectura del catálogo de Meta. Después selecciona “Sincronizar ahora”.</p></div></CardContent></Card>
        )}
      </div>
    </div>
  );
}
