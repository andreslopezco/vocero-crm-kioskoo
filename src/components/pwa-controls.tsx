"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, Download, Volume2, VolumeX, X } from "lucide-react";
import { useEvents } from "@/components/use-events";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type ConfigPush = { enabled: boolean; publicKey: string };

function esIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function estaInstalada(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function applicationServerKey(clave: string): ArrayBuffer {
  const normalized = clave.trim();
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  if (bytes.byteLength !== 65 || bytes[0] !== 4) {
    throw new Error("La clave de notificaciones del servidor no tiene un formato válido.");
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function obtenerContextoAudio(ref: { current: AudioContext | null }): AudioContext {
  if (!ref.current || ref.current.state === "closed") {
    ref.current = new AudioContext();
  }
  return ref.current;
}

function errorPush(error: unknown): string | null {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("push service") || message.includes("registration failed")) {
    return "El navegador no pudo conectarse a su servicio de notificaciones. Se reintentó y no respondió; revisa la conexión o las políticas del navegador y vuelve a probar.";
  }
  return null;
}

async function errorServidor(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown };
    };
    if (typeof body.error?.message === "string") return body.error.message;
  } catch {
    // Respuesta no JSON: se conserva el mensaje de reserva.
  }
  return fallback;
}

function sonar(context: AudioContext) {
  const start = context.currentTime;
  for (const [offset, frequency] of [[0, 740], [0.12, 988]] as const) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.5, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.17);
  }
}

export function PwaControls({
  onActivity,
  appName = "Vocero",
  showControls = true,
  handleEvents = true,
}: {
  onActivity?: () => void;
  appName?: string;
  /** Permite mantener el servicio activo en el cascarón sin pintar controles. */
  showControls?: boolean;
  /** Solo una instancia debe escuchar eventos y emitir el sonido. */
  handleEvents?: boolean;
}) {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [config, setConfig] = useState<ConfigPush | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const audioContext = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  useEffect(() => {
    const soundPreference = localStorage.getItem("vocero.soundEnabled.v1") === "true";
    soundEnabledRef.current = soundPreference;
    setSoundEnabled(soundPreference);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        if (showControls) {
          setFeedback("No se pudo preparar el servicio de notificaciones. Revisa que el sitio esté abierto con HTTPS.");
        }
      });
    }

    if (showControls) void fetch("/api/push/config")
      .then(async (response) => {
        if (!response.ok) {
          setFeedback(
            response.status === 404
              ? "Las notificaciones push no están habilitadas en este entorno."
              : "No se pudo consultar la configuración de notificaciones."
          );
          return null;
        }
        return (await response.json()) as ConfigPush;
      })
      .then((nextConfig) => {
        if (!nextConfig?.enabled || !nextConfig.publicKey) {
          setFeedback("Las notificaciones push no están habilitadas en este entorno.");
          return;
        }
        setConfig(nextConfig);
        if ("serviceWorker" in navigator && "PushManager" in window) {
          return navigator.serviceWorker.ready.then((registration) =>
            registration.pushManager.getSubscription().then((subscription) => {
              setSubscribed(Boolean(subscription));
            })
          );
        }
      })
      .catch(() => {
        setFeedback("No se pudo consultar la configuración de notificaciones.");
      });

    const onSoundSetting = (event: Event) => {
      const enabled = (event as CustomEvent<{ enabled?: boolean }>).detail?.enabled === true;
      soundEnabledRef.current = enabled;
      if (!enabled) return;
      if (typeof AudioContext === "undefined") return;
      try {
        const context = obtenerContextoAudio(audioContext);
        void context.resume();
      } catch {
        // El navegador puede no permitir audio hasta la siguiente interacción.
      }
    };
    if (handleEvents) window.addEventListener("vocero:sound-setting", onSoundSetting);
    return () => {
      if (handleEvents) window.removeEventListener("vocero:sound-setting", onSoundSetting);
    };

  }, [handleEvents, showControls]);

  const emitirSonido = useCallback(async () => {
    if (typeof AudioContext === "undefined") return;
    try {
      const context = obtenerContextoAudio(audioContext);
      if (context.state !== "running") await context.resume();
      if (context.state === "running") sonar(context);
    } catch {
      // El navegador puede suspender audio al dormir o dejar la pestaña inactiva.
      // Se vuelve a intentar con el próximo mensaje sin apagar la preferencia.
    }
  }, []);

  const onMessage = useCallback((data: { message: unknown }) => {
    onActivityRef.current?.();
    const message = data.message as { direction?: unknown } | null;
    if (message?.direction === "in" && soundEnabledRef.current) {
      void emitirSonido();
    }
  }, [emitirSonido]);

  useEvents({
    onMessageNew: handleEvents ? onMessage : undefined,
    onConversationUpdated: handleEvents
      ? () => onActivityRef.current?.()
      : undefined,
  }, handleEvents);

  async function alternarPush() {
    if (!window.isSecureContext) {
      setFeedback("Las notificaciones requieren una conexión segura (HTTPS).");
      return;
    }
    if (!config) {
      setFeedback("No se pudo cargar la configuración de notificaciones del servidor.");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setFeedback("Este navegador no admite notificaciones web push.");
      return;
    }
    try {
      if (!subscribed && esIos() && !estaInstalada()) {
        setFeedback(`En iPhone, primero agrega ${appName} a la pantalla de inicio y ábrelo desde su icono.`);
        return;
      }
      // Si el permiso aún no está decidido, solicitarlo antes de cualquier
      // operación asíncrona para conservar la activación del clic del usuario.
      if (!subscribed && Notification.permission === "denied") {
        setFeedback("Las notificaciones están bloqueadas para este sitio. Permítelas desde el icono junto a la dirección del navegador y vuelve a intentar.");
        return;
      }
      const permission = !subscribed && Notification.permission !== "granted"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (!subscribed && permission !== "granted") {
        setFeedback("No se concedió el permiso. Acepta las notificaciones del sitio para poder activarlas.");
        return;
      }

      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) {
        const response = await fetch("/api/push/subscription", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: current.endpoint }),
        });
        if (!response.ok) throw new Error(await errorServidor(response, "No se pudo guardar la preferencia"));
        await current.unsubscribe();
        setSubscribed(false);
        setFeedback("Notificaciones desactivadas en este dispositivo.");
        return;
      }

      const subscribe = () => registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(config.publicKey),
      });
      let subscription: PushSubscription;
      try {
        subscription = await subscribe();
      } catch (error) {
        // El servicio push del navegador a veces falla temporalmente al crear
        // el endpoint. Reintentar una vez evita dejar al usuario sin feedback.
        if (!errorPush(error)) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        subscription = await subscribe();
      }
      const response = await fetch("/api/push/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error(await errorServidor(response, "No se pudo registrar este dispositivo"));
      }
      setSubscribed(true);
      setFeedback("Notificaciones activadas para este dispositivo.");
    } catch (error) {
      setFeedback(
        errorPush(error) ??
          (error instanceof Error
            ? error.message
            : "No se pudieron configurar las notificaciones. Inténtalo otra vez.")
      );
    }
  }

  async function alternarSonido() {
    const next = !soundEnabled;
    if (next && handleEvents && typeof AudioContext !== "undefined") {
      try {
        const context = obtenerContextoAudio(audioContext);
        await context.resume();
      } catch {
        setFeedback("El navegador no permitió activar el sonido.");
        return;
      }
    }
    soundEnabledRef.current = next;
    setSoundEnabled(next);
    localStorage.setItem("vocero.soundEnabled.v1", String(next));
    if (!handleEvents) {
      window.dispatchEvent(
        new CustomEvent("vocero:sound-setting", { detail: { enabled: next } })
      );
    }
  }

  if (!showControls) return null;

  return (
    <div className="mb-4 rounded-md border bg-card p-4">
      <div className="mb-3 text-sm font-semibold text-foreground">
        Notificaciones y sonido
      </div>
      <div className="flex flex-wrap gap-2">
        {config && (
          <button
            type="button"
            onClick={() => void alternarPush()}
            aria-label={subscribed ? "Desactivar notificaciones" : "Activar notificaciones"}
            title={subscribed ? "Desactivar notificaciones" : "Activar notificaciones"}
            className="flex min-w-0 items-center justify-center gap-2 rounded-sm border px-3 py-2.5 text-xs font-semibold text-text-2 hover:bg-accent hover:text-foreground"
          >
            {subscribed ? <BellOff className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="truncate">{subscribed ? "Avisos sí" : "Avisos no"}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => void alternarSonido()}
          aria-pressed={soundEnabled}
          aria-label={soundEnabled ? "Silenciar mensajes" : "Activar sonido de mensajes"}
          title={soundEnabled ? "Silenciar mensajes" : "Activar sonido de mensajes"}
          className="flex min-w-0 items-center justify-center gap-2 rounded-sm border px-3 py-2.5 text-xs font-semibold text-text-2 hover:bg-accent hover:text-foreground"
        >
          {soundEnabled ? <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span className="truncate">{soundEnabled ? "Sonido sí" : "Sonido no"}</span>
        </button>
      </div>
      {feedback && (
        <p className="mt-2 text-xs leading-snug text-text-3" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}

const INSTALL_DISMISS_KEY = "vocero.installPromptDismissedAt.v1";
const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

function esTelefono(): boolean {
  const userAgent = navigator.userAgent;
  const userAgentData = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return (
    (userAgentData.userAgentData?.mobile === true ||
      /android|iphone|ipod|mobile/i.test(userAgent)) &&
    window.matchMedia("(max-width: 767px)").matches
  );
}

/** Aviso de instalación solo en teléfono, dentro del navegador y sin PWA instalada. */
export function PwaInstallPrompt({ appName = "Vocero" }: { appName?: string }) {
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const actualizaVisibilidad = () => {
      const mobile = esTelefono();
      const dismissedAt = Number(localStorage.getItem(INSTALL_DISMISS_KEY) ?? 0);
      const dismissedRecently =
        dismissedAt > 0 && Date.now() - dismissedAt < INSTALL_DISMISS_MS;
      setIos(esIos());
      setVisible(mobile && !estaInstalada() && !dismissedRecently);
    };
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setVisible(false);
      setInstallPrompt(null);
      localStorage.removeItem(INSTALL_DISMISS_KEY);
    };

    actualizaVisibilidad();
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("resize", actualizaVisibilidad);
    window.addEventListener("pageshow", actualizaVisibilidad);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("resize", actualizaVisibilidad);
      window.removeEventListener("pageshow", actualizaVisibilidad);
    };
  }, []);

  async function instalar() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "accepted") setVisible(false);
      return;
    }
    setInstructions(true);
  }

  function cerrar() {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <aside
      className="mx-3 my-2 flex items-start gap-3 rounded-md border border-brand/20 bg-brand-tint p-3 text-brand-text shadow-sm sm:mx-4 md:hidden"
      aria-label={`Instala ${appName} en tu celular`}
      role="region"
    >
      <Download className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Instala {appName} en tu celular</p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-2">
          Ábrelo como una aplicación y recibe avisos de nuevos mensajes.
        </p>
        {instructions && (
          <p className="mt-2 rounded-sm bg-background/70 px-2 py-1.5 text-xs leading-relaxed text-text-2" role="status">
            {ios
              ? "En Safari, toca Compartir y luego “Añadir a pantalla de inicio”."
              : "Abre el menú del navegador y elige “Instalar aplicación” o “Agregar a pantalla de inicio”."}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void instalar()}
        className="shrink-0 rounded-sm bg-brand px-3 py-2 text-xs font-semibold text-brand-fg hover:bg-brand/90"
      >
        {installPrompt ? "Instalar" : ios ? "Ver pasos" : "Instalar"}
      </button>
      <button
        type="button"
        onClick={cerrar}
        aria-label="Cerrar aviso de instalación por 7 días"
        className="-mr-1 -mt-1 rounded-sm p-1 text-text-3 hover:bg-background/60 hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </aside>
  );
}
