"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, Download, Volume2, VolumeX } from "lucide-react";
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
  const padded = `${clave}${"=".repeat((4 - (clave.length % 4)) % 4)}`;
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

function sonar(context: AudioContext) {
  const start = context.currentTime;
  for (const [offset, frequency] of [[0, 740], [0.12, 988]] as const) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.11, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.17);
  }
}

export function PwaControls({ onActivity }: { onActivity?: () => void }) {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [config, setConfig] = useState<ConfigPush | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  useEffect(() => {
    const soundPreference = localStorage.getItem("vocero.soundEnabled.v1") === "true";
    soundEnabledRef.current = soundPreference;
    setSoundEnabled(soundPreference);
    setInstalled(estaInstalada());
    setIos(esIos());

    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setFeedback("Vocero quedó instalado en este dispositivo.");
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        setFeedback("No se pudo preparar la app instalable en este navegador.");
      });
    }

    void fetch("/api/push/config")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as ConfigPush;
      })
      .then((nextConfig) => {
        if (!nextConfig?.enabled || !nextConfig.publicKey) return;
        setConfig(nextConfig);
        if ("serviceWorker" in navigator && "PushManager" in window) {
          return navigator.serviceWorker.ready.then((registration) =>
            registration.pushManager.getSubscription().then((subscription) => {
              setSubscribed(Boolean(subscription));
            })
          );
        }
      })
      .catch(() => {});

    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const onMessage = useCallback((data: { message: unknown }) => {
    onActivityRef.current?.();
    const message = data.message as { direction?: unknown } | null;
    if (message?.direction === "in" && soundEnabledRef.current) {
      const context = audioContext.current;
      if (context?.state === "running") sonar(context);
    }
  }, []);

  useEvents({
    onMessageNew: onMessage,
    onConversationUpdated: () => onActivityRef.current?.(),
  });

  async function instalar() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setInstallPrompt(null);
      return;
    }
    if (ios && !installed) {
      setFeedback("En Safari, toca Compartir y luego “Agregar a pantalla de inicio”.");
    } else if (!installed) {
      setFeedback("Abre el menú del navegador y elige “Instalar aplicación” o “Agregar a pantalla de inicio”.");
    } else {
      setFeedback("La aplicación ya está instalada en este dispositivo.");
    }
  }

  async function alternarPush() {
    if (!config || !("Notification" in window) || !("serviceWorker" in navigator)) {
      setFeedback("Este navegador no admite notificaciones web.");
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) {
        const response = await fetch("/api/push/subscription", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: current.endpoint }),
        });
        if (!response.ok) throw new Error("No se pudo guardar la preferencia");
        await current.unsubscribe();
        setSubscribed(false);
        setFeedback("Notificaciones desactivadas en este dispositivo.");
        return;
      }

      if (ios && !estaInstalada()) {
        setFeedback("En iPhone, primero agrega Vocero a la pantalla de inicio y ábrelo desde su icono.");
        return;
      }

      const permission =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      if (permission !== "granted") {
        setFeedback(
          permission === "denied"
            ? "El permiso está bloqueado en el navegador; habilítalo en la configuración del sitio."
            : "No se activaron las notificaciones."
        );
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(config.publicKey),
      });
      const response = await fetch("/api/push/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      });
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error("No se pudo registrar este dispositivo");
      }
      setSubscribed(true);
      setFeedback("Notificaciones activadas para este dispositivo.");
    } catch {
      setFeedback("No se pudieron configurar las notificaciones. Inténtalo otra vez.");
    }
  }

  async function alternarSonido() {
    const next = !soundEnabled;
    if (next && typeof AudioContext !== "undefined") {
      try {
        const context = audioContext.current ?? new AudioContext();
        audioContext.current = context;
        await context.resume();
      } catch {
        setFeedback("El navegador no permitió activar el sonido.");
        return;
      }
    }
    soundEnabledRef.current = next;
    setSoundEnabled(next);
    localStorage.setItem("vocero.soundEnabled.v1", String(next));
  }

  return (
    <div className="mx-1 mb-2 rounded-md border border-border/70 bg-background/40 p-2">
      <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-3">
        En este dispositivo
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => void instalar()}
          aria-label={installed ? "Ver instrucciones de instalación" : "Instalar Vocero"}
          title={installed ? "Ver instrucciones de instalación" : "Instalar Vocero"}
          className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-sm px-1.5 py-1.5 text-[10.5px] font-semibold text-text-2 hover:bg-accent hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{installed ? "Instalada" : "Instalar"}</span>
        </button>
        {config && (
          <button
            type="button"
            onClick={() => void alternarPush()}
            aria-label={subscribed ? "Desactivar notificaciones" : "Activar notificaciones"}
            title={subscribed ? "Desactivar notificaciones" : "Activar notificaciones"}
            className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-sm px-1.5 py-1.5 text-[10.5px] font-semibold text-text-2 hover:bg-accent hover:text-foreground"
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
          className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded-sm px-1.5 py-1.5 text-[10.5px] font-semibold text-text-2 hover:bg-accent hover:text-foreground"
        >
          {soundEnabled ? <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span className="truncate">{soundEnabled ? "Sonido sí" : "Sonido no"}</span>
        </button>
      </div>
      {feedback && (
        <p className="mt-1 px-1 text-[10px] leading-snug text-text-3" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}
