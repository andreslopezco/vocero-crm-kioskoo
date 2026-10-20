"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

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
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/dropi/settings", { method: "DELETE" });
      if (!response.ok) throw new Error("No se pudo desconectar Dropi.");
      await refresh();
      setMessage("Dropi desconectado.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo desconectar Dropi."); }
    finally { setBusy(false); }
  }

  if (!view) {
    return <div className="w-full max-w-3xl space-y-4 p-1" aria-live="polite">
      <div className="h-5 w-28 animate-pulse rounded bg-subtle" />
      <div className="h-9 w-64 animate-pulse rounded bg-subtle" />
      <div className="h-48 animate-pulse rounded-lg border bg-card" />
    </div>;
  }

  return (
    <div className="w-full max-w-3xl space-y-6">
      {!view.config.ready && (
        <div className="flex items-start gap-3 rounded-md border border-warning-soft bg-warning-tint p-4 text-sm text-warning-text" role="status">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Falta completar la configuración de la integración en el servidor.</p>
        </div>
      )}

      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Pedidos en Dropi</CardTitle>
            <Badge variant={view.connected ? "success" : "secondary"}>
              {view.connected ? "Conectado" : "Sin conectar"}
            </Badge>
          </div>
          <CardDescription>
            El agente puede preparar pedidos con los datos recopilados en la conversación y dejarlos listos para revisión humana en Dropi.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          {view.connected ? (
            <>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:items-start">
                <div className="space-y-2">
                  <Label htmlFor="dropi-rate-type">Tipo de recaudo</Label>
                  <select
                    id="dropi-rate-type"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={rateType}
                    onChange={(event) => setRateType(event.target.value as typeof rateType)}
                    disabled={!canConfigure || busy}
                  >
                    <option value="">Seleccionar…</option>
                    <option value="CON RECAUDO">Con recaudo</option>
                    <option value="SIN RECAUDO">Sin recaudo</option>
                  </select>
                  <p className="text-xs leading-5 text-text-3">Se incluirá al crear el pedido para revisión.</p>
                </div>
                <div className="space-y-2">
                  <Label>Herramientas disponibles</Label>
                  <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border bg-subtle px-3 py-2">
                    {view.tools.length
                      ? view.tools.map((tool) => <Badge key={tool} variant="secondary">{tool}</Badge>)
                      : <span className="text-sm text-text-3">Pendiente de lectura</span>}
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-border-strong p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={view.orderCreationEnabled}
                    disabled={!canConfigure || busy}
                    onChange={(event) => setView({ ...view, orderCreationEnabled: event.target.checked })}
                    className="mt-1 h-4 w-4 accent-primary disabled:cursor-not-allowed"
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-semibold">Permitir crear pedidos desde el agente</span>
                    <span className="block text-sm leading-5 text-text-2">
                      El pedido queda pendiente para revisión humana. Vocero no le confirmará la compra al cliente; el equipo deberá validar los datos y la disponibilidad directamente en Dropi.
                    </span>
                  </span>
                </label>
              </div>

              {view.lastError && (
                <div className="flex items-start gap-2 rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text" role="alert">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{view.lastError}</p>
                </div>
              )}

              {canConfigure && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void save()} disabled={busy || !rateType}>
                    {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Guardar ajustes
                  </Button>
                  <Button variant="outline" onClick={() => void refresh()} disabled={busy}>
                    <RefreshCw className="h-4 w-4" /> Actualizar estado
                  </Button>
                  <Button variant="ghost" onClick={() => void disconnect()} disabled={busy} className="text-destructive hover:text-destructive">
                    <Unplug className="h-4 w-4" /> Desconectar
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <p className="max-w-xl text-sm leading-6 text-text-2">
                Al conectar Dropi podrás vincular pedidos existentes y usar sus estados y guías como contexto para el equipo.
              </p>
              {canConfigure ? (
                <Button onClick={() => void connect()} disabled={busy || !view.config.ready}>
                  {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  Conectar cuenta Dropi
                </Button>
              ) : (
                <p className="text-sm text-text-3">Pídele a una persona administradora que conecte la cuenta.</p>
              )}
            </div>
          )}

          {message && (
            <p className="rounded-md border bg-subtle px-3 py-2 text-sm text-text-2" role="status" aria-live="polite">
              {message}
            </p>
          )}
        </CardContent>
      </Card>

      <p className="text-xs leading-5 text-text-3">
        La creación en Dropi no significa que el pedido esté confirmado. El equipo debe revisar la disponibilidad y los datos antes de confirmar al cliente.
      </p>
    </div>
  );
}
