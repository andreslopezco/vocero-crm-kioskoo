"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2 } from "lucide-react";
import type { Branding } from "@/lib/branding";
import { faviconHref, FAVICON_MIMES, MAX_FAVICON_BYTES } from "@/lib/favicon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function TabIconCard({ branding }: { branding: Branding }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [actual, setActual] = useState(branding.tabIcon);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentBrand = { ...branding, tabIcon: actual };
  const src = `${faviconHref(currentBrand)}&r=${revision}`;

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_FAVICON_BYTES) {
      setError(`El favicon no puede pasar de ${Math.round(MAX_FAVICON_BYTES / 1024)} KB.`);
      return;
    }
    setBusy(true);
    const response = await fetch("/api/settings/branding/tab-icon", {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "No se pudo subir el favicon.");
      return;
    }
    const body = (await response.json()) as { tabIcon: Branding["tabIcon"] };
    setActual(body.tabIcon);
    setRevision((value) => value + 1);
    router.refresh();
  }

  async function remove() {
    setError(null);
    setBusy(true);
    const response = await fetch("/api/settings/branding/tab-icon", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError("No se pudo quitar el favicon.");
      return;
    }
    setActual(null);
    setRevision((value) => value + 1);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Favicon de la pestaña</CardTitle>
        <CardDescription>Personaliza el icono pequeño que aparece en la pestaña del navegador. No cambia el logo ni el icono de la app instalada.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="Vista previa del favicon" width={48} height={48} className="h-12 w-12 rounded-lg border bg-card object-contain" />
          <p className="text-sm text-text-2">{actual ? "Favicon personalizado activo" : branding.favicon ? "Usando el logo del CRM" : "Generado con tu marca"}</p>
        </div>
        <input ref={input} type="file" accept={FAVICON_MIMES.join(",")} className="hidden" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}><ImageUp className="h-4 w-4" /> {busy ? "Subiendo…" : actual ? "Cambiar favicon" : "Subir favicon"}</Button>
          {actual && <Button variant="ghost" disabled={busy} onClick={() => void remove()}><Trash2 className="h-4 w-4" /> Quitar</Button>}
        </div>
        <p className="text-xs text-text-3">PNG, SVG, ICO, JPEG o WebP, hasta {Math.round(MAX_FAVICON_BYTES / 1024)} KB.</p>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
