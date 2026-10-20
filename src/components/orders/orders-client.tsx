"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  PackageCheck,
  RefreshCw,
  Search,
  Truck,
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
  carrier: string | null;
  createdAt: string | null;
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

function displayDate(value: string | null) {
  if (!value) return "No disponible";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "No disponible";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }).format(date);
}

function displayMoney(value: string | null, currency: string | null) {
  if (!value) return null;
  const raw = value.trim().replace(/[^\d,.-]/g, "");
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  let normalized = raw;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalDigits = raw.length - decimalIndex - 1;
    normalized = decimalDigits > 0 && decimalDigits <= 2
      ? raw.slice(0, decimalIndex).replace(/[,.]/g, "") + "." + raw.slice(decimalIndex + 1)
      : raw.replace(/[,.]/g, "");
  } else if (decimalIndex >= 0) {
    const decimalDigits = raw.length - decimalIndex - 1;
    normalized = decimalDigits > 0 && decimalDigits <= 2
      ? raw.slice(0, decimalIndex).replace(/[,.]/g, "") + "." + raw.slice(decimalIndex + 1)
      : raw.replace(/[,.]/g, "");
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return value;
  const code = (currency ?? "COP").toUpperCase();
  const formatted = new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return code === "COP" ? `${formatted} COP` : `${formatted} ${code}`;
}

function searchText(order: Order) {
  return [
    order.orderId,
    order.providerOrderId,
    order.shopOrderId,
    order.contactName,
    order.contactPhone,
    order.trackingCode,
    order.carrier,
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
      <div className="w-full flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">

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
              <div className="overflow-hidden rounded-lg border bg-card" aria-label="Cargando pedidos">
                <div className="h-10 animate-pulse border-b bg-subtle" />
                {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse border-b last:border-0 bg-card" />)}
              </div>
            ) : orders.length ? (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table aria-label="Pedidos registrados" className="w-full min-w-[1180px] table-fixed text-sm">
                  <colgroup>
                    <col className="w-[12%]" />
                    <col className="w-[15%]" />
                    <col className="w-[14%]" />
                    <col className="w-[27%]" />
                    <col className="w-[11%]" />
                    <col className="w-[10%]" />
                    <col className="w-[11%]" />
                  </colgroup>
                  <thead className="kicker border-b bg-subtle text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2.5 font-medium sm:px-4">ID de pedido</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Fecha</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Contacto</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Productos</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Envío</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Total</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.providerOrderId ?? order.shopOrderId ?? order.orderId} className="border-t align-middle first:border-t-0">
                        <td className="min-w-0 px-3 py-3 sm:px-4">
                          <p className="break-all font-semibold leading-5">
                            {order.providerOrderId ?? (order.shopOrderId && !/^voc-/i.test(order.shopOrderId) ? order.shopOrderId : "Pendiente")}
                          </p>

                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <p className="text-xs text-text-2">{displayDate(order.createdAt)}</p>
                          <p className="mt-1 text-[10px] leading-4 text-text-3">Actualizado {displayDate(order.updatedAt)}</p>
                        </td>
                        <td className="min-w-0 px-3 py-3">
                          <p className="truncate font-medium" title={order.contactName}>{order.contactName}</p>
                          <p className="mt-0.5 truncate text-xs text-text-3">{order.contactPhone ?? "Sin teléfono"}</p>
                        </td>
                        <td className="px-3 py-3">
                          {order.items.length ? (
                            <div className="space-y-1">
                              {order.items.slice(0, 2).map((item, index) => (
                                <p key={item.name + index} className="flex min-w-0 items-center justify-between gap-2">
                                  <span className="min-w-0 truncate" title={item.name}>{item.name}</span>
                                  {item.quantity && <span className="shrink-0 text-xs text-text-3">× {item.quantity}</span>}
                                </p>
                              ))}
                              {order.items.length > 2 && <p className="text-xs text-text-3">y {order.items.length - 2} producto(s) más</p>}
                            </div>
                          ) : <span className="text-text-3">Detalle no disponible</span>}
                        </td>
                        <td className="min-w-0 px-3 py-3">
                          {order.carrier && <p className="truncate text-xs font-medium" title={order.carrier}>{order.carrier}</p>}
                          {order.trackingCode
                            ? <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-text-2" title={`Guía ${order.trackingCode}`}>
                                <Truck className="h-3 w-3 shrink-0" />
                                <span className="break-all">Guía {order.trackingCode}</span>
                              </p>
                            : !order.carrier && <span className="text-xs text-text-3">Sin información</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-semibold">
                          {displayMoney(order.total, order.currency) ?? <span className="font-normal text-text-3">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          <Badge
                            className="max-w-full truncate whitespace-nowrap px-1.5 py-0.5 text-[9px] leading-4"
                            title={statusText(order.status)}
                            variant={statusVariant(order.status)}
                          >
                            {statusText(order.status)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <PackageCheck className="mx-auto h-8 w-8 text-text-3" />
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
