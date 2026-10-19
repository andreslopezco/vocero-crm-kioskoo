"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Image as ImageIcon, PackageSearch, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
type ProductForm = {
  retailerId: string;
  name: string;
  description: string;
  availability: "in stock" | "out of stock" | "preorder";
  condition: "new" | "refurbished" | "used";
  price: string;
  currency: string;
  brand: string;
  imageUrl: string;
  url: string;
  category: string;
  material: string;
  color: string;
  size: string;
  pattern: string;
};
type ProductEditor = { mode: "create" | "edit"; product?: Product };

const EMPTY_FORM: ProductForm = {
  retailerId: "", name: "", description: "", availability: "in stock", condition: "new",
  price: "", currency: "COP", brand: "", imageUrl: "", url: "", category: "",
  material: "", color: "", size: "", pattern: "",
};

function formFromProduct(product: Product): ProductForm {
  const currency = product.currency ?? product.price?.match(/[A-Z]{3}$/)?.[0] ?? "COP";
  let price = (product.price ?? "").replace(currency, "").replace(/[^\d.,]/g, "").trim();
  if (price.includes(",") && price.includes(".")) {
    price = price.lastIndexOf(",") > price.lastIndexOf(".")
      ? price.replace(/\./g, "").replace(",", ".")
      : price.replace(/,/g, "");
  } else if (price.includes(",")) {
    price = price.replace(/,(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  } else if (price.includes(".") && /\.\d{3}$/.test(price)) {
    price = price.replace(/\./g, "");
  }
  const value = (key: string) => {
    const item = product.attributes[key];
    return typeof item === "string" || typeof item === "number" ? String(item) : "";
  };
  return {
    retailerId: product.retailerId,
    name: product.name,
    description: product.description ?? "",
    availability: product.availability === "out of stock" || product.availability === "preorder" ? product.availability : "in stock",
    condition: product.attributes.condition === "used" || product.attributes.condition === "refurbished" ? product.attributes.condition : "new",
    price,
    currency,
    brand: product.brand ?? "",
    imageUrl: product.imageUrl ?? "",
    url: product.url ?? "",
    category: value("category"),
    material: value("material"),
    color: value("color"),
    size: value("size"),
    pattern: value("pattern"),
  };
}

function showValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  try { return JSON.stringify(value); } catch { return ""; }
}

function ProductImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-subtle text-text-3">
      {src && !failed ? (
        // La URL de imagen proviene del catálogo de Meta y puede ser de cualquier CDN.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : <ImageIcon className="h-5 w-5" aria-hidden />}
    </div>
  );
}

export function CatalogPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editor, setEditor] = useState<ProductEditor | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
      setSuccess("Catálogo sincronizado con Meta.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo sincronizar el catálogo.");
    } finally {
      setSyncing(false);
    }
  }

  function openEditor(mode: "create" | "edit", product?: Product) {
    setSuccess(null);
    setForm(product ? formFromProduct(product) : EMPTY_FORM);
    setFormError(null);
    setEditor({ mode, product });
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch("/api/settings/catalog/products", {
        method: editor.mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, price: form.price.trim(), currency: form.currency.trim().toUpperCase() }),
      });
      const data = await response.json() as { ok?: boolean; synced?: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "No se pudo guardar el producto.");
      setEditor(null);
      await load();
      setSuccess(data.synced
        ? editor.mode === "create" ? "Producto creado en Meta." : "Producto actualizado en Meta."
        : "Meta guardó el producto, pero no se pudo actualizar la vista. Pulsa «Sincronizar» para recargarla.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo guardar el producto.");
    } finally {
      setSaving(false);
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
          {catalog && <Button size="sm" onClick={() => openEditor("create")}>
            <Plus className="mr-1.5 h-4 w-4" /> Nuevo producto
          </Button>}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-6">
        {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        {success && <div role="status" className="rounded-lg border border-success-soft bg-success-tint px-3 py-2 text-sm text-success-text">{success}</div>}

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
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table aria-label="Productos sincronizados del catálogo" className="w-full min-w-[760px] table-fixed text-sm">
                  <colgroup>
                    <col className="w-[27%]" />
                    <col className="w-[11%]" />
                    <col className="w-[14%]" />
                    <col className="w-[18%]" />
                    <col className="w-[22%]" />
                    <col className="w-[8%]" />
                  </colgroup>
                  <thead className="kicker border-b bg-subtle text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2.5 font-medium sm:px-4">Producto</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Marca</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Precio</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Disponibilidad</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Información</th>
                      <th scope="col" className="px-2 py-2.5 text-right font-medium">Editar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((product) => {
                      const attributes = Object.entries(product.attributes).filter(([, value]) => value != null && showValue(value) !== "");
                      return <tr key={product.retailerId} className="border-t align-middle first:border-t-0">
                        <td className="min-w-0 px-3 py-3 sm:px-4">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <ProductImage src={product.imageUrl} alt={`Imagen de ${product.name}`} />
                            <div className="min-w-0">
                              <p className="line-clamp-2 font-medium leading-5" title={product.name}>{product.name}</p>
                              <p className="line-clamp-2 text-xs leading-4 text-muted-foreground" title={product.description ?? product.retailerId}>
                                {product.description ? `Descripción: ${product.description}` : `ID: ${product.retailerId}`}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">{product.brand ?? <span className="text-text-3">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-3 font-semibold">
                          {product.price ? `${product.price}${product.currency ? ` ${product.currency}` : ""}` : <span className="font-normal text-text-3">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={product.availability === "in stock" ? "success" : "secondary"}>
                            {product.availability === "in stock" ? "Disponible" : product.availability ?? "No informada"}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          {attributes.length > 0 || product.url ? <details className="max-w-full">
                            <summary className="cursor-pointer truncate text-xs font-semibold text-brand">Ver detalles</summary>
                            <div className="mt-2 max-h-72 w-64 max-w-full overflow-y-auto rounded-lg border bg-subtle p-3 text-xs">
                              <p className="mb-2 font-semibold">ID: {product.retailerId}</p>
                              {product.description && <p className="mb-3 line-clamp-2 whitespace-pre-wrap text-text-2" title={product.description}>Descripción: {product.description}</p>}
                              {attributes.length > 0 && <dl className="space-y-2">
                                {attributes.map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-2 border-t pt-1.5">
                                  <dt className="break-words text-muted-foreground">{key.replaceAll("_", " ")}</dt>
                                  <dd className="break-words">{showValue(value)}</dd>
                                </div>)}
                              </dl>}
                              {product.url && <a href={product.url} target="_blank" rel="noreferrer" className="mt-3 inline-block font-semibold text-brand hover:underline">Abrir en tienda</a>}
                            </div>
                          </details> : <span className="text-text-3">—</span>}
                        </td>
                        <td className="px-2 py-3 text-right">
                          <Button size="icon" variant="ghost" aria-label={`Editar ${product.name}`} title={`Editar ${product.name}`} onClick={() => openEditor("edit", product)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
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
      {editor && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4">
        <section role="dialog" aria-modal="true" aria-labelledby="catalog-product-title" className="my-auto max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border bg-card shadow-xl">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-card px-5 py-4">
            <div>
              <h3 id="catalog-product-title" className="text-base font-semibold">{editor.mode === "create" ? "Nuevo producto" : "Editar producto"}</h3>
              <p className="mt-1 text-xs text-text-3">Los cambios se guardan directamente en el catálogo de Meta.</p>
            </div>
            <Button type="button" size="icon" variant="ghost" aria-label="Cerrar" disabled={saving} onClick={() => setEditor(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <form onSubmit={(event) => void saveProduct(event)} className="space-y-4 p-5">
            {formError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{formError}</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium">
                <span>Identificador / SKU</span>
                <Input required maxLength={100} value={form.retailerId} disabled={editor.mode === "edit" || saving} onChange={(event) => setForm({ ...form, retailerId: event.target.value })} placeholder="SKU-001" />
                <span className="block text-xs font-normal text-text-3">No se puede cambiar después de crear el producto.</span>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>Nombre</span>
                <Input required maxLength={200} value={form.name} disabled={saving} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nombre del producto" />
              </label>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Descripción</span>
              <Textarea required maxLength={5000} rows={3} value={form.description} disabled={saving} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe el producto para tus clientes" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium">
                <span>Precio</span>
                <Input required inputMode="decimal" value={form.price} disabled={saving} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="309900" />
                <span className="block text-xs font-normal text-text-3">Solo números, sin separadores de miles.</span>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>Moneda (ISO 4217)</span>
                <Input required minLength={3} maxLength={3} value={form.currency} disabled={saving} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} placeholder="COP" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>Disponibilidad</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft" value={form.availability} disabled={saving} onChange={(event) => setForm({ ...form, availability: event.target.value as ProductForm["availability"] })}>
                  <option value="in stock">Disponible</option>
                  <option value="out of stock">Agotado</option>
                  <option value="preorder">En preventa</option>
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>Condición</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft" value={form.condition} disabled={saving} onChange={(event) => setForm({ ...form, condition: event.target.value as ProductForm["condition"] })}>
                  <option value="new">Nuevo</option>
                  <option value="refurbished">Reacondicionado</option>
                  <option value="used">Usado</option>
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>Marca</span>
                <Input maxLength={100} value={form.brand} disabled={saving} onChange={(event) => setForm({ ...form, brand: event.target.value })} placeholder="Marca" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>Categoría</span>
                <Input maxLength={200} value={form.category} disabled={saving} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Hogar y cocina" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>Material</span>
                <Input maxLength={200} value={form.material} disabled={saving} onChange={(event) => setForm({ ...form, material: event.target.value })} placeholder="Acero inoxidable" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>Color</span>
                <Input maxLength={100} value={form.color} disabled={saving} onChange={(event) => setForm({ ...form, color: event.target.value })} placeholder="Color" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>Tamaño</span>
                <Input maxLength={100} value={form.size} disabled={saving} onChange={(event) => setForm({ ...form, size: event.target.value })} placeholder="5 y 7 litros" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>Diseño / patrón</span>
                <Input maxLength={100} value={form.pattern} disabled={saving} onChange={(event) => setForm({ ...form, pattern: event.target.value })} placeholder="Opcional" />
              </label>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>URL HTTPS de la imagen principal</span>
              <Input required type="url" value={form.imageUrl} disabled={saving} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} placeholder="https://…" />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>URL HTTPS del producto</span>
              <Input required type="url" value={form.url} disabled={saving} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://…" />
            </label>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditor(null)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Guardando…" : editor.mode === "create" ? "Crear producto" : "Guardar cambios"}
              </Button>
            </div>
          </form>
        </section>
      </div>}
    </div>
  );
}
