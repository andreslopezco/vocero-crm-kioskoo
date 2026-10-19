"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, PlugZap, Unplug } from "lucide-react";

type View = {
  connected: boolean;
  status: string;
  lastError: string | null;
  rateType: "CON RECAUDO" | "SIN RECAUDO" | null;
  orderCreationEnabled: boolean;
  tools: string[];
  config: { ready: boolean; callbackUrl?: string; message?: string };
};

export function DropiSettingsClient({ canConfigure }: { canConfigure: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [rateType, setRateType] = useState<"CON RECAUDO" | "SIN RECAUDO" | "">("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch("/api/dropi/settings", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json() as View;
      setView(data);
      setRateType(data.rateType ?? "");
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function connect() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/dropi/authorize", { method: "POST" });
      const data = await response.json() as { authorizationUrl?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "No se pudo iniciar la conexión.");
      if (data.authorizationUrl) window.location.assign(data.authorizationUrl);
      else await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo conectar Dropi."); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/dropi/settings", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ rateType: rateType || null, orderCreationEnabled: view?.orderCreationEnabled ?? false }),
      });
      const data = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? "No se pudieron guardar los ajustes.");
      setMessage("Ajustes guardados."); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm("¿Desconectar Dropi de esta organización?")) return;
    setBusy(true);
    try { await fetch("/api/dropi/settings", { method: "DELETE" }); await refresh(); setMessage("Dropi desconectado."); }
    finally { setBusy(false); }
  }

  if (!view) return <div className="p-6 text-sm text-text-2">Cargando conexión con Dropi…</div>;
  return <div className="mx-auto max-w-2xl space-y-6">
    <div>
      <p className="kicker">Integraciones</p>
      <h1 className="mt-1 text-xl font-bold">Pedidos en Dropi</h1>
      <p className="mt-2 text-sm text-text-2">El agente podrá preparar pedidos con los datos confirmados durante la conversación y dejarlos para revisión humana.</p>
    </div>
    {!view.config.ready && <div className="rounded-md border border-warning/30 bg-warning/5 p-4 text-sm">Falta completar la configuración de la integración en el servidor.</div>}
    <section className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {view.connected ? <CheckCircle2 className="h-4 w-4 text-success" /> : <CircleAlert className="h-4 w-4 text-text-2" />}
        {view.connected ? "Cuenta de Dropi conectada" : "Cuenta de Dropi sin conectar"}
      </div>
      {view.connected ? <>
        <label className="block space-y-1 text-sm"><span className="font-medium">Tipo de recaudo</span>
          <select className="w-full rounded-md border bg-background px-3 py-2" value={rateType} onChange={(e) => setRateType(e.target.value as typeof rateType)} disabled={!canConfigure || busy}>
            <option value="">Seleccionar…</option><option value="CON RECAUDO">Con recaudo</option><option value="SIN RECAUDO">Sin recaudo</option>
          </select>
        </label>
        <p className="text-xs text-text-2">Herramientas disponibles: {view.tools.length ? view.tools.join(", ") : "pendiente de lectura"}</p>
        {view.lastError && <p className="text-sm text-destructive">{view.lastError}</p>}
        <label className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
          <input type="checkbox" checked={view.orderCreationEnabled} disabled={!canConfigure || busy} onChange={(e) => setView({ ...view, orderCreationEnabled: e.target.checked })} className="mt-0.5" />
          <span><strong>Permitir crear pedidos desde el agente</strong><br/>Actívalo solo después de verificar que Dropi los deja pendientes de confirmación y no genera despacho ni notificación al cliente. Vocero no confirmará el pedido al comprador.</span>
        </label>
        {canConfigure && <div className="flex flex-wrap gap-2"><button onClick={() => void save()} disabled={busy || !rateType} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Guardando…" : "Guardar ajustes"}</button><button onClick={() => void disconnect()} disabled={busy} className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm"><Unplug className="h-4 w-4"/> Desconectar</button></div>}
      </> : canConfigure && <button onClick={() => void connect()} disabled={busy || !view.config.ready} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin"/> : <PlugZap className="h-4 w-4"/>} Conectar cuenta Dropi</button>}
      {message && <p className="text-sm text-text-2">{message}</p>}
    </section>
    <p className="text-xs text-text-2">En caso de creación, Vocero no dirá que el pedido está confirmado; el equipo deberá verificar los datos y la disponibilidad en Dropi.</p>
  </div>;
}
