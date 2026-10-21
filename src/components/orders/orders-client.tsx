"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  CircleCheck,
  CircleX,
  Clock3,
  MoreHorizontal,
  PackageCheck,
  RotateCcw,
  RefreshCw,
  Search,
  Trash2,
  Truck,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Order = {
  orderId: string;
  providerOrderId: string | null;
  shopOrderId: string | null;
  contactId: string | null;
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
  source: "linked" | "vocero" | "dropi";
};

type OrdersResponse = { connected: boolean; orders: Order[]; deletedOrders?: Order[] };
type ContactOption = { id: string; name: string; phone: string | null };

function statusText(value: string | null) {
  const status = (value ?? "").trim().toLowerCase().replace(/[ -]+/g, "_");
  const labels: Record<string, string> = {
    submitting: "Enviando a Dropi",
    submitted: "Pendiente de revisión",
    needs_review: "Requiere revisión",
    unknown: "Estado por verificar",
    failed: "No se pudo crear",
    pending: "Pendiente",
    pending_confirmation: "Pendiente confirmación",
    pendiente_confirmacion: "Pendiente confirmación",
    confirmed: "Confirmado",
    delivered: "Entregado",
    cancelled: "Cancelado",
    canceled: "Cancelado",
  };
  return labels[status] ?? (value?.trim() || "Sin estado");
}

function statusVariant(value: string | null): "success" | "warning" | "attention" | "info" | "destructive" | "secondary" {
  const status = normalizedStatus(value);
  if (isUnsuccessful(value)) return "destructive";
  if (isDelivered(value)) return "success";
  if (isAttentionRequired(value)) return "attention";
  if (isInTransit(value)) return "info";
  if (isPending(value) || /pending[ _-]*confirm|pending confirmation|needs_review/.test(status)) return "secondary";
  if (/review|requiere revision/.test(status)) return "attention";
  return "secondary";
}

function normalizedStatus(value: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[ _-]+/g, " ");
}

const PENDING_STATUSES = new Set([
  // Estados de Dropi antes de que el paquete entre en tránsito.
  "pendiente confirmacion",
  "pendiente",
  "generando guia",
  "guia generada",
  "preparado para transportadora",

  // Estados equivalentes de transportadoras: guía creada, aún sin movimiento.
  "generada",
  "producida",
  "a recibir por coordinadora",
  "en alistamiento en oficina de origen",
]);

const ATTENTION_STATUSES = new Set([
  "error generando guia",
  "guia no existe",
  "no transmitida",
  "sin movimientos",
  "novedad",
  "en investigacion",
  "cerrado por incidencia ver causa",
  "fisico no recibido",
  "stand by",
  "cerrado por incidencia, ver causa",
  "para reclamar en oficina",
  "en confirmacion telefonica",
  "para bodega final/custodia",
  "en bodega final/custodia",
  "no llego el envio fisico",
  "en auditoria en terreno",
  "telemercadeo",
  "reclame en oficina",
  "en confirmacin telefnica",
  "no llego el envo fsico",
  "guia sin sobre",
  "novedad en aeropuerto",
  "problemas de orden publico",
  "cierre de vias publicas",
  "no se cubre la zona",
  "mal zonificado",
  "condiciones climatologicas adversas",
  "entregada parcialmente",
  "mercancia retenida por la dian",
]);

function isAttentionRequired(value: string | null) {
  return ATTENTION_STATUSES.has(normalizedStatus(value));
}

function isPending(value: string | null) {
  return PENDING_STATUSES.has(normalizedStatus(value));
}

const IN_TRANSIT_STATUSES = new Set([
  // Dropi: estados de movimiento por su red y entrega a transportadora.
  "entregado a transportadora",
  "en bodega dropi",
  "recogido por dropi",
  "recibido pau",
  "recibido por dropi",

  // Servientrega.
  "ingreso al centro logistico",
  "en zona de distribucion",
  "salio a ciudad destino",

  // Envia.
  "despachada",
  "despachada de transito",
  "en transito",
  "en bodega destino",
  "en reparto",
  "en reexpedicion",
  "mercancia recogida",

  // Coordinadora.
  "en terminal origen",
  "en transporte",
  "en terminal destino",

  // Interrapidisimo.
  "envio admitido",
  "admitida",
  "ingresado a bodega",
  "centro acopio",
  "viajando en ruta nacional",
  "viajando en ruta regional",
  "transito nacional",
  "transito regional",
  "transito urbano",
  "despachado para bodega",
  "en distribucion urbana",
  "en distribucion urbana agencia",
  "distribucion",
  "reparto",
  "reenvio",
  "intento de entrega",
  "para nuevo intento entrega",

  // Domina.
  "asignado a zona",
  "transporte nacional",
  "recepcion bodega",
  "asignado a courier",
  "asignado a sucursal destino",

  // Veloces.
  "en ruta",
  "en camino",

  // SUPPLI-EXPRESS-ESM.
  "en transito a ciudad destino",
  "en distribucion",
  "llego a oficina de destino",

  // TCC.
  "en aerolinea de miami",
  "en aerolinea de colombia",
  "en despacho",
  "en traslado nacional",
  "en recibo",
  "entregada a conexiones",

  // Estados logísticos adicionales devueltos por Dropi y sus transportadoras.
  "novedad solucionada",
  "en espera de rx",
  "en espera de ruta domestica",
  "en espera de cita",
  "cita programada",
  "solucionada en malla",
  "origen domestico en espera de despacho nacional",
  "redireccionado",
  "en punto droop",
  "envo admitido",
  "en distribucin urbana",
  "distribucion",
  "distribucin",
  "en proceso",
  "cargado en base",
  "bodega",
  "bodega destino",
  "en bodega origen",
  "recoleccion",
  "recogido",
  "recibido punto de venta",
  "agendado",
  "reagendado",
  "en proceso de inspeccion aduanera",
  "mercancia nacionalizada",
  "cargada",
  "digitada",
  "en continuacion",
]);

function isInTransit(value: string | null) {
  return IN_TRANSIT_STATUSES.has(normalizedStatus(value));
}

function isDelivered(value: string | null) {
  const status = normalizedStatus(value);
  return new Set([
    "delivered",
    "entregado",
    "entregada",
    "entrega exitosa",
    "reportado entregado",
    "entregada digitalizada",
    "entrega digitalizada",
    "entregada con observacion",
    "entregada con boomerang",
    "despacho efectivo",
    "despacho efectivo digitalizada",
    "entrega verificada",
    "prueba de entrega digitalizada",
    "prueba de entrega archivada",
  ]).has(status);
}

const ADDITIONAL_UNSUCCESSFUL_STATUSES = new Set([
  "finalizado por retencion",
  "devuelta",
  "dev otros",
  "dev cerrado cuarentena",
  "devuelta a remitente",
  "en traslado nacional con boomerang",
  "en bodega origen con boomerang",
  "en distribucion con boomerang",
]);

function isUnsuccessful(value: string | null) {
  const status = normalizedStatus(value);
  return ADDITIONAL_UNSUCCESSFUL_STATUSES.has(status)
    || /cancel|rechaz|devol|return|anulad|no entregad|rezago|destruccion|indemniz|siniestro|incaut|cerrado o no hay quien reciba|compensacion|al remitente|devuelt/.test(status);
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
  const [actionOrderId, setActionOrderId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [assignmentOrderId, setAssignmentOrderId] = useState<string | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
  const [contactLookupBusy, setContactLookupBusy] = useState(false);
  const [assigningOrderId, setAssigningOrderId] = useState<string | null>(null);
  const [restoringOrderId, setRestoringOrderId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);

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
              : "Actualización lista. Dropi no devolvió pedidos para esta cuenta."
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

  useEffect(() => {
    const query = contactQuery.trim();
    if (!assignmentOrderId || query.length < 2) {
      setContactOptions([]);
      setContactLookupBusy(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setContactLookupBusy(true);
      try {
        const response = await fetch(`/api/contacts?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const body = await response.json().catch(() => null) as { contacts?: ContactOption[] } | null;
        if (active) setContactOptions(response.ok ? body?.contacts ?? [] : []);
      } catch {
        if (active) setContactOptions([]);
      } finally {
        if (active) setContactLookupBusy(false);
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [assignmentOrderId, contactQuery]);

  const sourceOrders = showDeleted ? data?.deletedOrders ?? [] : data?.orders ?? [];

  useEffect(() => {
    if (!actionOrderId) return;

    const updateMenuPosition = () => {
      const trigger = Array.from(document.querySelectorAll<HTMLElement>("[data-order-menu-trigger]"))
        .find((element) => element.dataset.orderMenuTrigger === actionOrderId);
      if (!trigger) {
        setActionOrderId(null);
        setMenuPosition(null);
        return;
      }

      const rect = trigger.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
        setActionOrderId(null);
        setMenuPosition(null);
        return;
      }

      const top = rect.bottom + 4;

      setMenuPosition({ top, right: Math.max(8, window.innerWidth - rect.right) });
    };

    window.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);
    return () => {
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [actionOrderId, assignmentOrderId, showDeleted, sourceOrders]);
  const orders = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return sourceOrders.filter((order) => {
      if (normalized && !searchText(order).includes(normalized)) return false;
      return true;
    });
  }, [sourceOrders, query]);

  const ordersForSummary = data?.orders ?? [];
  const pendingConfirmation = ordersForSummary.filter((order) => isPending(order.status)).length;
  const requiresAttention = ordersForSummary.filter((order) => isAttentionRequired(order.status)).length;
  const inTransit = ordersForSummary.filter((order) => isInTransit(order.status)).length;
  const delivered = ordersForSummary.filter((order) => isDelivered(order.status)).length;
  const unsuccessful = ordersForSummary.filter((order) => isUnsuccessful(order.status)).length;

  async function removeOrder(order: Order) {
    const orderId = order.providerOrderId ?? order.shopOrderId ?? order.orderId;
    if (!window.confirm(`¿Eliminar del CRM el pedido ${orderId}? Solo se ocultará en Vocero; no se cancelará ni eliminará en Dropi.`)) return;
    setDeletingOrderId(orderId);
    setError(null);
    try {
      const response = await fetch("/api/orders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "No se pudo eliminar el pedido de Vocero.");
      setActionOrderId(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo eliminar el pedido de Vocero.");
    } finally {
      setDeletingOrderId(null);
    }
  }

  async function restoreOrder(order: Order) {
    const orderId = order.providerOrderId ?? order.shopOrderId ?? order.orderId;
    setRestoringOrderId(orderId);
    setError(null);
    try {
      const response = await fetch("/api/orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "No se pudo restaurar el pedido.");
      setActionOrderId(null);
      setNotice("El pedido " + orderId + " volvió a mostrarse en Vocero.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo restaurar el pedido.");
    } finally {
      setRestoringOrderId(null);
    }
  }

  async function assignContact(order: Order, contact: ContactOption) {
    const orderId = order.providerOrderId ?? order.shopOrderId ?? order.orderId;
    setAssigningOrderId(orderId);
    setError(null);
    try {
      const response = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, contactId: contact.id }),
      });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "No se pudo asignar el pedido.");
      setAssignmentOrderId(null);
      setActionOrderId(null);
      setContactQuery("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo asignar el pedido.");
    } finally {
      setAssigningOrderId(null);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
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
      <div className="w-full min-w-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto p-4 sm:p-6">

        {!data?.connected && (
          <div className="flex items-start gap-3 rounded-md border border-warning-soft bg-warning-tint p-4 text-sm text-warning-text" role="status">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Dropi no está conectado. Aquí puedes consultar los pedidos que ya quedaron guardados o vinculados.</p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Card>
            <CardContent className="flex items-center gap-3 pt-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-subtle text-text-2"><Clock3 className="h-4 w-4" /></span>
              <div><p className="text-xs font-medium text-text-3">Pendientes</p><p className="text-xl font-bold">{loading ? "—" : pendingConfirmation}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-attention-tint text-attention-text"><AlertCircle className="h-4 w-4" /></span>
              <div><p className="text-xs font-medium text-text-3">Requieren atención</p><p className="text-xl font-bold">{loading ? "—" : requiresAttention}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-info-tint text-info-text"><Truck className="h-4 w-4" /></span>
              <div><p className="text-xs font-medium text-text-3">En tránsito</p><p className="text-xl font-bold">{loading ? "—" : inTransit}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success-tint text-success-text"><CircleCheck className="h-4 w-4" /></span>
              <div><p className="text-xs font-medium text-text-3">Entregados</p><p className="text-xl font-bold">{loading ? "—" : delivered}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 pt-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-danger-tint text-danger-text"><CircleX className="h-4 w-4" /></span>
              <div><p className="text-xs font-medium text-text-3">No exitosos</p><p className="text-xl font-bold">{loading ? "—" : unsuccessful}</p></div>
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0">
          <CardHeader className="min-w-0 gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div><CardTitle>Todos los pedidos</CardTitle><CardDescription>Los pedidos quedan asociados a su contacto y se ordenan por actividad reciente.</CardDescription></div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar pedido, contacto o producto" className="pl-9" aria-label="Buscar pedidos" />
            </div>
          </CardHeader>
          <CardContent className="min-w-0 space-y-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Pedidos">
              <Button type="button" size="sm" variant={!showDeleted ? "secondary" : "ghost"} aria-pressed={!showDeleted} onClick={() => { setShowDeleted(false); setActionOrderId(null); }}>
                Todos <span className="ml-1 text-text-3">{data?.orders.length ?? 0}</span>
              </Button>
              <Button type="button" size="sm" variant={showDeleted ? "secondary" : "ghost"} aria-pressed={showDeleted} onClick={() => { setShowDeleted(true); setActionOrderId(null); }}>
                Eliminados <span className="ml-1 text-text-3">{data?.deletedOrders?.length ?? 0}</span>
              </Button>
            </div>

            {error && <div role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-4 py-3 text-sm text-danger-text">{error}</div>}
            {notice && <div role="status" className="rounded-md border border-border-strong bg-subtle px-4 py-3 text-sm text-text-2">{notice}</div>}

            {loading ? (
              <div className="overflow-hidden rounded-lg border bg-card" aria-label="Cargando pedidos">
                <div className="h-10 animate-pulse border-b bg-subtle" />
                {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse border-b last:border-0 bg-card" />)}
              </div>
            ) : orders.length ? (
              <div className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-lg border bg-card">
                <table aria-label="Pedidos registrados" className="w-full min-w-[1180px] table-fixed text-sm">
                  <colgroup>
                    <col className="w-[9%]" />
                    <col className="w-[14%]" />
                    <col className="w-[14%]" />
                    <col className="w-[26%]" />
                    <col className="w-[11%]" />
                    <col className="w-[9%]" />
                    <col className="w-[13%]" />
                    <col className="w-[4%]" />
                  </colgroup>
                  <thead className="kicker border-b bg-subtle text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2.5 font-medium sm:px-4">ID pedido</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Fecha</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Contacto</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Productos</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Envío</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Total</th>
                      <th scope="col" className="px-3 py-2.5 font-medium">Estado</th>
                      <th scope="col" className="px-2 py-2.5 font-medium"><span className="sr-only">Acciones</span></th>
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
                            ? <p className="mt-1 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-text-2" title={order.trackingCode}>
                                <Truck className="h-3 w-3 shrink-0" />
                                <span className="whitespace-nowrap">{order.trackingCode}</span>
                              </p>
                            : !order.carrier && <span className="text-xs text-text-3">Sin información</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-semibold">
                          {displayMoney(order.total, order.currency) ?? <span className="font-normal text-text-3">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          <Badge
                            className="max-w-full truncate whitespace-nowrap uppercase px-1 py-0 text-[9px] leading-3"
                            title={statusText(order.status)}
                            variant={statusVariant(order.status)}
                          >
                            {statusText(order.status)}
                          </Badge>
                        </td>
                        <td className="px-2 py-3 text-right">
                          <div className="relative flex justify-end">
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              aria-label={`Acciones para pedido ${order.providerOrderId ?? order.shopOrderId ?? order.orderId}`}
                              aria-haspopup="menu"
                              data-order-menu-trigger={order.providerOrderId ?? order.shopOrderId ?? order.orderId}
                              aria-expanded={actionOrderId === (order.providerOrderId ?? order.shopOrderId ?? order.orderId)}
                              onClick={(event) => {
                                const id = order.providerOrderId ?? order.shopOrderId ?? order.orderId;
                                if (actionOrderId === id) {
                                  setActionOrderId(null);
                                  setMenuPosition(null);
                                  return;
                                }
                                const rect = event.currentTarget.getBoundingClientRect();
                                const top = rect.bottom + 4;
                                setMenuPosition({ top, right: Math.max(8, window.innerWidth - rect.right) });
                                setActionOrderId(id);
                              }}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                            {actionOrderId === (order.providerOrderId ?? order.shopOrderId ?? order.orderId) && menuPosition && createPortal(
                              <div
                                role="menu"
                                className={`fixed z-[1000] max-h-[calc(100vh-1rem)] overflow-y-auto rounded-md border bg-card p-1 shadow-lg ${assignmentOrderId === (order.providerOrderId ?? order.shopOrderId ?? order.orderId) ? "w-64" : "min-w-44"}`}
                                style={{ top: menuPosition.top, right: menuPosition.right, maxWidth: "calc(100vw - 1rem)" }}
                              >
                                {showDeleted ? (
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={restoringOrderId !== null}
                                    onClick={() => void restoreOrder(order)}
                                    className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-subtle disabled:opacity-50"
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                    Restaurar en CRM
                                  </button>
                                ) : (
                                  <>
                                {order.source === "dropi" && !order.contactId && (
                                  <>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        const id = order.providerOrderId ?? order.shopOrderId ?? order.orderId;
                                        setAssignmentOrderId((current) => current === id ? null : id);
                                        setContactQuery("");
                                        setContactOptions([]);
                                      }}
                                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-subtle"
                                    >
                                      <UserPlus className="h-4 w-4" />
                                      Asignar a un contacto
                                    </button>
                                    {assignmentOrderId === (order.providerOrderId ?? order.shopOrderId ?? order.orderId) && (
                                      <div className="space-y-2 border-y px-2 py-2">
                                        <Input
                                          autoFocus
                                          value={contactQuery}
                                          onChange={(event) => setContactQuery(event.target.value)}
                                          placeholder="Buscar nombre o teléfono"
                                          aria-label="Buscar contacto para asignar pedido"
                                          className="h-8 text-xs"
                                        />
                                        {contactQuery.trim().length < 2 ? (
                                          <p className="text-xs text-text-3">Escribe al menos 2 caracteres.</p>
                                        ) : contactLookupBusy ? (
                                          <p className="text-xs text-text-3">Buscando contactos…</p>
                                        ) : contactOptions.length ? (
                                          <div className="max-h-40 space-y-1 overflow-y-auto">
                                            {contactOptions.map((contact) => (
                                              <button
                                                key={contact.id}
                                                type="button"
                                                disabled={assigningOrderId !== null}
                                                onClick={() => void assignContact(order, contact)}
                                                className="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-subtle disabled:opacity-50"
                                              >
                                                <span className="w-full truncate text-xs font-medium">{contact.name}</span>
                                                {contact.phone && <span className="w-full truncate text-[10px] text-text-3">{contact.phone}</span>}
                                              </button>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="text-xs text-text-3">No se encontraron contactos.</p>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )}
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={deletingOrderId !== null || assigningOrderId !== null}
                                  onClick={() => void removeOrder(order)}
                                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-danger-text hover:bg-danger-tint disabled:opacity-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Eliminar del CRM
                                </button>
                                  </>
                                )}
                              </div>,
                              document.body
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <PackageCheck className="mx-auto h-8 w-8 text-text-3" />
                <p className="mt-3 text-sm font-semibold">{sourceOrders.length ? "No hay pedidos con esos filtros" : showDeleted ? "No hay pedidos eliminados" : "Aún no hay pedidos"}</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-text-2">
                  {sourceOrders.length ? "Prueba otra búsqueda o cambia el filtro." : showDeleted ? "Los pedidos que elimines del CRM aparecerán aquí y podrás restaurarlos." : "Cuando Vocero prepare un pedido o vincules uno de Dropi a un contacto, aparecerá aquí."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
