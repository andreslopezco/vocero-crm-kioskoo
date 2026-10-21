import { PwaControls } from "@/components/pwa-controls";
import { getBranding } from "@/server/branding";
import { getSessionOrNull } from "@/lib/auth/session";

export default async function GeneralSettingsPage() {
  const session = await getSessionOrNull();
  const branding = await getBranding(session?.organizationId);
  return (
    <section className="max-w-2xl">
      <div className="mb-6">
        <p className="kicker mb-2">Preferencias</p>
        <h1 className="text-xl font-bold tracking-tight">General</h1>
        <p className="mt-2 text-sm leading-relaxed text-text-2">
          Administra cómo recibes avisos y sonido de los mensajes en este dispositivo.
        </p>
      </div>
      <PwaControls appName={branding.name} handleEvents={false} />
    </section>
  );
}
