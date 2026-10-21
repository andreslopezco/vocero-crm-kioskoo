import { getEnv } from "@/lib/env";

export function parsePushHabilitado(config: {
  flag?: string;
  publicKey?: string;
  privateKey?: string;
  subject?: string;
}): boolean {
  const subject = config.subject?.trim() ?? "";
  const subjectValido =
    subject.startsWith("mailto:") ||
    (() => {
      try {
        return new URL(subject).protocol === "https:";
      } catch {
        return false;
      }
    })();
  return Boolean(
    config.flag?.trim().toLowerCase() === "on" &&
      config.publicKey?.trim() &&
      config.privateKey?.trim() &&
      subjectValido
  );
}

/** Push es un conector opcional: no hace llamadas externas sin bandera y VAPID. */
export function pushHabilitado(): boolean {
  const env = getEnv();
  return parsePushHabilitado({
    flag: env.PUSH_NOTIFICATIONS,
    publicKey: env.PUSH_VAPID_PUBLIC_KEY,
    privateKey: env.PUSH_VAPID_PRIVATE_KEY,
    subject: env.PUSH_VAPID_SUBJECT,
  });
}

export function clavePublicaPush(): string | null {
  return pushHabilitado() ? getEnv().PUSH_VAPID_PUBLIC_KEY ?? null : null;
}
