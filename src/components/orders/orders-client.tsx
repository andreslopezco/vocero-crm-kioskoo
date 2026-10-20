"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CircleCheck,
  PackageCheck,
  RefreshCw,
  Search,
  Truck,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Order = {
  orderId: string;
  providerOrderId: string | null;
  shopOrderId: string | null;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  status: string | null;
  trackingCode: string | null;
  total: string | null;
  currency: string | null;
  items: { name: string; quantity: string | null }[];
  updatedAt: string;
  source: "linked" | "vocero";
};

type OrdersResponse = { connected: boolean; orders: Order[] };
type Filter = "all" | "review";

function statusText(value: string | null) {
  const status = (value ?? "").trim().toLowerCase().replace(/[ -]+/g, "_");
  const labels: Record<string, string> = {
    submitting: "Enviando a Dropi",
    submitted: "Pendiente de revisión",
    needs_review: "Requiere revisión",
    unknown: "Estado por verificar",
    failed: "No se pudo crear",
    pending: "Pendiente",
    pending_confirmation: "Pendiente de confirmación",
    confirmed: "Confirmado",
    delivered: "Entregado",
    cancelled: "Cancelado",
    canceled: "Cancelado",
  };
  return labels[status] ?? (value?.trim() || "Sin estado");
}

function statusVariant(value: string | null): "success" | "warning" | "destructive" | "secondary" {
  const status = (value ?? "").toLowerCase();
  if (/delivered|confirm|complete/.test(status)) return "success";
  if (/fail|error|cancel/.test(status)) return "destructive";
  if (/review|unknown|submitt|pending/.test(status)) return "warning";
  return "secondary";
}

function displayDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function searchText(order: Order) {
  return [
    order.orderId,
    order.providerOrderId,
    order.shopOrderId,
    order.contactName,
    order.contactPhone,
    order.trackingCode,
    ...order.items.map((item) => item.name),
  ].filter(Boolean).join(" ").toLocaleLowerCase("es");
}

export function OrdersClient() {
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    if (!quiet) setNotice(null);
    try {
      if (quiet) {
        const refreshResponse = await fetch("/api/orders", { method: "POST", cache: "no-store" });
        const refreshBody = await refreshResponse.json().catch(() => null) as
          | { refreshedOrders?: number; reconciledOrders?: number; failedOrders?: number; error?: { message?: string } }
          | null;
        if (!refreshResponse.ok || !refreshBody) {
          throw new Error(refreshBody?.error?.message ?? "No se pudieron actualizar los pedidos.");
        }
        const refreshed = refreshBody.refreshedOrders ?? 0;
        const reconciled = refreshBody.reconciledOrders ?? 0;
        const failed = refreshBody.failedOrders ?? 0;
        setNotice(
          refreshed || reconciled
            ? `Actualización lista: ${refreshed} pedido(s) consultado(s) en Dropi y ${reconciled} solicitud(es) de Vocero vinculada(s).${failed ? ` ${failed} pedido(s) no se pudieron actualizar.` : ""}`
            : failed
              ? `No se pudieron actualizar ${failed} pedido(s) en Dropi. Revisa la conexión e inténtalo de nuevo.`
              : "Actualización lista. No había pedidos vinculados que requirieran sincronización."
        );
      }
      const response = await fetch("/api/orders", { cache: "no-store" });
      const body = await response.json().catch(() => null) as (OrdersResponse & { error?: { message?: string } }) | null;
      if (!response.ok || !body) throw new Error(body?.error?.message ?? "No se pudieron cargar los pedidos.");
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los pedidos.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const orders = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return (data?.orders ?? []).filter((order) => {
      if (normalized && !searchText(order).includes(normalized)) return false;
      if (filter === "review" && !/review|unknown|submitt|pending/i.test(order.status ?? "")) return false;
      return true;
    });
  }, [data, filter, query]);

  const needsReview = (data?.orders ?? []).filter((order) =>
    /review|unknown|submitt|pending/i.test(order.status ?? "")
  ).length;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-tight">Pedidos</h2>
          <p className="text-xs text-text-3">Consulta en un solo lugar los pedidos registrados para tus contactos.</p>
        </div>
        <Button variant="outline" onClick={() => void load(true)} disabled={loading || refreshing}>
          <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Actualizar
        </Button>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 space-y-6 overflow-y-auto p-4 sm:p-6 lg:p-8">

        {!data?.connected && (
          <div className="flex items-start gap-3 rounded-md border border-warning-soft bg-warning-tint p-4 text-sm text-warning-text" role="status">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Dropi no está conectado. Aquí puedes consultar los pedidos que ya quedaron guardados o vinculados.</p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardContent className="flex items-center gap-3 pt-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-tint text-brand-text"><PackageCheck className="h-4 w-4" /></span>
              <div><p className="text-xs font-medium text-text-3">Pedidos registrados</p><p className="text-xl font-bold">{loading ? "—" : data?.orders.length ?? 0}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-warning-tint text-warning-text"><AlertCircle className="h-4 w-4" /></span>
              <div><p className="text-xs font-medium text-text-3">Pendientes de revisión</p><p className="text-xl font-bold">{loading ? "—" : needsReview}</p></div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div><CardTitle>Todos los pedidos</CardTitle><CardDescription>Los pedidos quedan asociados a su contacto y se ordenan por actividad reciente.</CardDescription></div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pedido, contacto o producto" className="pl-9" aria-label="Buscar pedidos" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar pedidos">
              {([
                ["all", "Todos"],
                ["review", "Pendientes de revisión"],
              ] as const).map(([value, label]) => (
                <Button key={value} type="button" size="sm" variant={filter === value ? "secondary" : "ghost"} onClick={() => setFilter(value)} aria-pressed={filter === value}>
                  {label}
                </Button>
              ))}
            </div>

            {error && <div role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-4 py-3 text-sm text-danger-text">{error}</div>}
            {notice && <div role="status" className="rounded-md border border-border-strong bg-subtle px-4 py-3 text-sm text-text-2">{notice}</div>}

            {loading ? (
              <div className="space-y-3" aria-label="Cargando pedidos">
                {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-md bg-subtle" />)}
              </div>
            ) : orders.length ? (
              <div className="space-y-3">
                {orders.map((order) => (
                  <article key={order.providerOrderId ?? order.shopOrderId ?? order.orderId} className="rounded-md border border-border-strong p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="break-all text-sm font-bold">{order.providerOrderId ? `Pedido ${order.providerOrderId}` : "Pedido pendiente de revisión"}</h3>
                          <Badge variant={statusVariant(order.status)}>{statusText(order.status)}</Badge>
                        </div>
                        {order.trackingCode && <p className="mt-1 flex items-center gap-1.5 text-xs text-text-2"><Truck className="h-3.5 w-3.5" />Guía {order.trackingCode}</p>}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div>
                        <p className="flex items-center gap-2 text-xs font-semibold text-text-3"><UserRound className="h-3.5 w-3.5" />Contacto</p>
                        <p className="mt-1 text-sm font-medium">{order.contactName}</p>
                        {order.contactPhone && <p className="text-xs text-text-2">{order.contactPhone}</p>}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-text-3">Productos</p>
                        {order.items.length ? (
                          <ul className="mt-1 space-y-1 text-sm">
                            {order.items.slice(0, 4).map((item, index) => <li key={item.name + index} className="flex justify-between gap-3"><span className="min-w-0 truncate">{item.name}</span>{item.quantity && <span className="shrink-0 text-text-2">× {item.quantity}</span>}</li>)}
                            {order.items.length > 4 && <li className="text-xs text-text-3">y {order.items.length - 4} productos más</li>}
                          </ul>
                        ) : <p className="mt-1 text-sm text-text-3">Detalle no disponible</p>}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-text-3">
                      <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{displayDate(order.updatedAt)}</span>
                      {order.total && <span className="font-semibold text-foreground">{order.total}{order.currency ? " " + order.currency : ""}</span>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center">
                <CircleCheck className="mx-auto h-8 w-8 text-text-3" />
                <p className="mt-3 text-sm font-semibold">{data?.orders.length ? "No hay pedidos con esos filtros" : "Aún no hay pedidos"}</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-text-2">
                  {data?.orders.length ? "Prueba otra búsqueda o cambia el filtro." : "Cuando Vocero prepare un pedido o vincules uno de Dropi a un contacto, aparecerá aquí."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
