"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Image as ImageIcon, PackageSearch, Pencil, Plus, RefreshCw, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Product = {
  retailerId: string;
  dropiProductId: string | null;
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
  dropiProductId: string;
  name: string;
  description: string;
  availability: "" | "in stock" | "out of stock" | "preorder";
  condition: "" | "new" | "refurbished" | "used";
  inventory: string;
  price: string;
  currency: string;
  brand: string;
  url: string;
  category: string;
  material: string;
  color: string;
  size: string;
  pattern: string;
};
type ProductEditor = { mode: "create" | "edit"; product?: Product };

const EMPTY_FORM: ProductForm = {
  retailerId: "", dropiProductId: "", name: "", description: "", availability: "", condition: "",
  inventory: "",
  price: "", currency: "", brand: "", url: "", category: "",
  material: "", color: "", size: "", pattern: "",
};

function formFromProduct(product: Product): ProductForm {
  const currency = product.currency ?? product.price?.match(/[A-Z]{3}$/)?.[0] ?? "";
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
    dropiProductId: product.dropiProductId ?? "",
    name: product.name,
    description: product.description ?? "",
    availability: product.availability === "in stock" || product.availability === "out of stock" || product.availability === "preorder" ? product.availability : "",
    condition: product.attributes.condition === "new" || product.attributes.condition === "used" || product.attributes.condition === "refurbished" ? product.attributes.condition : "",
    inventory: value("quantity_to_sell_on_facebook") || value("inventory"),
    price,
    currency,
    brand: product.brand ?? "",
    url: product.url ?? "",
    category: value("category"),
    material: value("material"),
    color: value("color"),
    size: value("size"),
    pattern: value("pattern"),
  };
}

function FieldLabel({ children, required = false }: { children: React.ReactNode; required?: boolean }) {
  return <span>{children}{required && <span aria-hidden="true" className="ml-1 text-danger-text">*</span>}</span>;
}

function showValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  try { return JSON.stringify(value); } catch { return ""; }
}

const DETAIL_LABELS: Record<string, string> = {
  status: "Estado en Meta",
  condition: "Condición",
  inventory: "Unidades en inventario (Meta)",
  material: "Material",
  color: "Color",
  size: "Tamaño",
  pattern: "Diseño",
  category: "Categoría",
  product_type: "Tipo de producto",
  manufacturer_part_number: "Referencia del fabricante",
  gtin: "Código de barras",
  origin_country: "País de origen",
  gender: "Público",
  age_group: "Edad recomendada",
  sale_price: "Precio de oferta",
  tags: "Etiquetas",
};

const DETAIL_VALUE_TRANSLATIONS: Record<string, Record<string, string>> = {
  status: { PUBLISHED: "Publicado", PENDING: "Pendiente", REJECTED: "Rechazado", PROCESSING: "En revisión", IN_REVIEW: "En revisión" },
  condition: { new: "Nuevo", refurbished: "Reacondicionado", used: "Usado" },
  gender: { male: "Hombres", female: "Mujeres", unisex: "Unisex" },
  age_group: { newborn: "Recién nacido", infant: "Bebé", toddler: "Niño pequeño", kids: "Niños", adult: "Adultos" },
};

function productDetails(product: Product): Array<{ label: string; value: string }> {
  const details: Array<{ label: string; value: string }> = [];
  const attributes = product.attributes;

  for (const [key, label] of Object.entries(DETAIL_LABELS)) {
    const raw = key === "inventory"
      ? attributes.quantity_to_sell_on_facebook ?? attributes.inventory
      : attributes[key];
    if (raw == null || typeof raw === "object" || raw === "") continue;
    if (key !== "inventory" && (raw === 0 || raw === "0")) continue;

    const text = String(raw).trim();
    if (!text) continue;
    const translated = DETAIL_VALUE_TRANSLATIONS[key]?.[text.toLowerCase()]
      ?? DETAIL_VALUE_TRANSLATIONS[key]?.[text.toUpperCase()]
      ?? text.replaceAll("_", " ");
    const value = key === "inventory"
      ? `${text} ${text === "1" ? "unidad" : "unidades"}`
      : key === "sale_price" && product.currency
        ? `${text} ${product.currency}`
        : translated;
    details.push({ label, value });
  }

  const weight = attributes.shipping_weight_value;
  const unit = attributes.shipping_weight_unit;
  if (typeof weight === "number" && Number.isFinite(weight) && weight > 0) {
    const formatted = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(weight);
    const unitLabel = typeof unit === "string" ? ` ${unit.toLowerCase()}` : "";
    details.push({ label: "Peso de envío", value: `${formatted}${unitLabel}` });
  }

  return details;
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
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

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
                      const details = productDetails(product);
                      const expanded = expandedProductId === product.retailerId;
                      return <Fragment key={product.retailerId}>
                        <tr className="border-t align-middle first:border-t-0">
                          <td className="min-w-0 px-3 py-3 sm:px-4">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <ProductImage key={`${product.retailerId}:${product.imageUrl ?? ""}`} src={product.imageUrl} alt={`Imagen de ${product.name}`} />
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
                            {details.length > 0 || product.description || product.url || product.dropiProductId ? <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-expanded={expanded}
                              aria-controls={`catalog-details-${product.retailerId}`}
                              className="h-auto px-0 py-1 text-xs font-semibold text-brand hover:bg-transparent"
                              onClick={() => setExpandedProductId(expanded ? null : product.retailerId)}
                            >
                              <ChevronDown className={`mr-1 h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                              {expanded ? "Ocultar detalles" : "Ver detalles"}
                            </Button> : <span className="text-text-3">—</span>}
                          </td>
                          <td className="px-2 py-3 text-right">
                            <Button size="icon" variant="ghost" aria-label={`Editar ${product.name}`} title={`Editar ${product.name}`} onClick={() => openEditor("edit", product)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                        {expanded && <tr className="border-t bg-subtle/50">
                          <td id={`catalog-details-${product.retailerId}`} colSpan={6} className="px-3 pb-4 pt-3 sm:px-4">
                            <section aria-label={`Detalles de ${product.name}`} className="rounded-lg border bg-card p-4">
                              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                                {product.dropiProductId && <div className="min-w-0 border-t pt-2 text-xs sm:border-t-0 sm:pt-0">
                                  <p className="text-muted-foreground">ID de producto en Dropi</p>
                                  <p className="mt-1 break-words font-medium">{product.dropiProductId}</p>
                                </div>}
                                {product.description && <div className="min-w-0 text-xs">
                                  <p className="text-muted-foreground">Descripción</p>
                                  <p className="mt-1 whitespace-pre-wrap break-words font-medium text-text-2">{product.description}</p>
                                </div>}
                                {details.map(({ label, value }) => <div key={label} className="min-w-0 border-t pt-2 text-xs sm:border-t-0 sm:pt-0">
                                  <p className="text-muted-foreground">{label}</p>
                                  <p className="mt-1 break-words font-medium">{value}</p>
                                </div>)}
                                {product.url && <div className="border-t pt-2 text-xs sm:border-t-0 sm:pt-0">
                                  <a href={product.url} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">Ver página del producto</a>
                                </div>}
                              </div>
                            </section>
                          </td>
                        </tr>}
                      </Fragment>;
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
              <p className="mt-1 text-xs text-text-3">Los datos comerciales se guardan en Meta; el ID de Dropi se conserva solo en el catálogo local.</p>
            </div>
            <Button type="button" size="icon" variant="ghost" aria-label="Cerrar" disabled={saving} onClick={() => setEditor(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <form onSubmit={(event) => void saveProduct(event)} className="space-y-4 p-5">
            {formError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{formError}</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel required>Identificador / SKU</FieldLabel>
                <Input required maxLength={100} value={form.retailerId} disabled={editor.mode === "edit" || saving} onChange={(event) => setForm({ ...form, retailerId: event.target.value })} placeholder="Identificador / SKU" />
                <span className="block text-xs font-normal text-text-3">No se puede cambiar después de crear el producto.</span>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel required>Nombre</FieldLabel>
                <Input required maxLength={200} value={form.name} disabled={saving} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nombre" />
              </label>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              <FieldLabel>ID de producto en Dropi</FieldLabel>
              <Input inputMode="numeric" pattern="[0-9]*" maxLength={24} value={form.dropiProductId} disabled={saving} onChange={(event) => setForm({ ...form, dropiProductId: event.target.value })} placeholder="ID numérico del producto en Dropi" />
              <span className="block text-xs font-normal text-text-3">Vincula este producto local con el ID que aparece en Dropi. No se envía a Meta.</span>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <FieldLabel required>Descripción</FieldLabel>
              <Textarea required maxLength={5000} rows={3} value={form.description} disabled={saving} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Descripción" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel required>Precio</FieldLabel>
                <Input required inputMode="decimal" value={form.price} disabled={saving} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="Precio" />
                <span className="block text-xs font-normal text-text-3">Solo números, sin separadores de miles.</span>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel required>Moneda (ISO 4217)</FieldLabel>
                <Input required minLength={3} maxLength={3} value={form.currency} disabled={saving} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} placeholder="Moneda (ISO 4217)" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel required>Disponibilidad</FieldLabel>
                <select required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft" value={form.availability} disabled={saving} onChange={(event) => setForm({ ...form, availability: event.target.value as ProductForm["availability"] })}>
                  <option value="" disabled>Disponibilidad</option>
                  <option value="in stock">Disponible</option>
                  <option value="out of stock">Agotado</option>
                  <option value="preorder">En preventa</option>
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel required>Condición</FieldLabel>
                <select required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft" value={form.condition} disabled={saving} onChange={(event) => setForm({ ...form, condition: event.target.value as ProductForm["condition"] })}>
                  <option value="" disabled>Condición</option>
                  <option value="new">Nuevo</option>
                  <option value="refurbished">Reacondicionado</option>
                  <option value="used">Usado</option>
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel>Unidades en inventario (Meta)</FieldLabel>
                <Input inputMode="numeric" pattern="[0-9]*" value={form.inventory} disabled={saving} onChange={(event) => setForm({ ...form, inventory: event.target.value })} placeholder="Unidades en inventario (Meta)" />
                <span className="block text-xs font-normal text-text-3">Se guarda en el catálogo de Meta. Es distinto de marcarlo como disponible o agotado.</span>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel>Marca</FieldLabel>
                <Input maxLength={100} value={form.brand} disabled={saving} onChange={(event) => setForm({ ...form, brand: event.target.value })} placeholder="Marca" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel>Categoría</FieldLabel>
                <Input maxLength={200} value={form.category} disabled={saving} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Categoría" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel>Material</FieldLabel>
                <Input maxLength={200} value={form.material} disabled={saving} onChange={(event) => setForm({ ...form, material: event.target.value })} placeholder="Material" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel>Color</FieldLabel>
                <Input maxLength={100} value={form.color} disabled={saving} onChange={(event) => setForm({ ...form, color: event.target.value })} placeholder="Color" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel>Tamaño</FieldLabel>
                <Input maxLength={100} value={form.size} disabled={saving} onChange={(event) => setForm({ ...form, size: event.target.value })} placeholder="Tamaño" />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <FieldLabel>Diseño / patrón</FieldLabel>
                <Input maxLength={100} value={form.pattern} disabled={saving} onChange={(event) => setForm({ ...form, pattern: event.target.value })} placeholder="Diseño / patrón" />
              </label>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              <FieldLabel required>URL HTTPS del producto</FieldLabel>
              <Input required type="url" value={form.url} disabled={saving} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="URL HTTPS del producto" />
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
