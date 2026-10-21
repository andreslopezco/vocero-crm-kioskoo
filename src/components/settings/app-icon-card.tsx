"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2 } from "lucide-react";
import type { Branding } from "@/lib/branding";
import { appIconHref } from "@/lib/favicon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AppIconCard({ branding }: { branding: Branding }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [actual, setActual] = useState(branding.appIcon);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const src = actual ? `${appIconHref({ ...branding, appIcon: actual })}&r=${revision}` : "/apple-icon";

  async function upload(file: File) {
    setError(null);
    setBusy(true);
    const response = await fetch("/api/settings/branding/app-icon", {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: file,
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "No se pudo subir el icono.");
      return;
    }
    const body = (await response.json()) as { appIcon: Branding["appIcon"] };
    setActual(body.appIcon);
    setRevision((value) => value + 1);
    router.refresh();
  }

  async function remove() {
    setError(null);
    setBusy(true);
    const response = await fetch("/api/settings/branding/app-icon", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError("No se pudo quitar el icono.");
      return;
    }
    setActual(null);
    setRevision((value) => value + 1);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Icono de la aplicación</CardTitle>
        <CardDescription>
          Se usa como icono al instalar en Android y iPhone, sin cambiar el logo del CRM ni el favicon de la pestaña.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="Vista previa del icono de la aplicación" width={64} height={64} className="h-16 w-16 rounded-xl border bg-card object-contain" />
          <p className="text-sm text-text-2">{actual ? "Icono personalizado activo" : "Se genera con el nombre y color de tu marca"}</p>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
            <ImageUp className="h-4 w-4" /> {busy ? "Guardando…" : actual ? "Cambiar icono" : "Subir icono"}
          </Button>
          {actual && <Button variant="ghost" disabled={busy} onClick={() => void remove()}><Trash2 className="h-4 w-4" /> Quitar</Button>}
        </div>
        <p className="text-xs text-text-3">PNG cuadrado, entre 512×512 y 2048×2048 píxeles, máximo 1 MB. El mismo archivo se adapta para Android y Apple.</p>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
