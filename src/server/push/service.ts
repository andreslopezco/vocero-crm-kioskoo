import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { scoped } from "@/lib/db/tenant";
import { pushHabilitado } from "./flag";

export type SuscripcionWebPush = {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
};

function hashEndpoint(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

function configurarVapid() {
  const env = getEnv();
  if (!pushHabilitado()) throw new Error("Web Push no está habilitado");
  webpush.setVapidDetails(
    env.PUSH_VAPID_SUBJECT!,
    env.PUSH_VAPID_PUBLIC_KEY!,
    env.PUSH_VAPID_PRIVATE_KEY!
  );
}

export async function guardarSuscripcion(input: {
  organizationId: string;
  userId: string;
  suscripcion: SuscripcionWebPush;
}): Promise<void> {
  const db = getDb();
  const cifrado = encryptSecret(JSON.stringify(input.suscripcion));
  await db
    .insert(schema.pushSubscription)
    .values({
      id: newId("pushSubscription"),
      organizationId: input.organizationId,
      userId: input.userId,
      endpointHash: hashEndpoint(input.suscripcion.endpoint),
      payloadCipher: cifrado.cipher,
      payloadIv: cifrado.iv,
      payloadTag: cifrado.tag,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.pushSubscription.endpointHash,
      set: {
        organizationId: input.organizationId,
        userId: input.userId,
        payloadCipher: cifrado.cipher,
        payloadIv: cifrado.iv,
        payloadTag: cifrado.tag,
        updatedAt: new Date(),
      },
    });
}

export async function revocarSuscripcion(input: {
  organizationId: string;
  userId: string;
  endpoint: string;
}): Promise<void> {
  await getDb()
    .delete(schema.pushSubscription)
    .where(
      scoped(
        schema.pushSubscription.organizationId,
        input.organizationId,
        and(
          eq(schema.pushSubscription.userId, input.userId),
          eq(schema.pushSubscription.endpointHash, hashEndpoint(input.endpoint))
        )
      )
    );
}

/**
 * El mensaje ya fue persistido y deduplicado por la ingesta. El push es solo
 * mejor esfuerzo: un gateway externo caído nunca deshace el mensaje ni frena
 * la respuesta de IA.
 */
export async function notificarMensajeEntrante(
  organizationId: string,
  nombreContacto?: string | null
): Promise<void> {
  if (!pushHabilitado()) return;
  configurarVapid();
  const db = getDb();
  const filas = await db
    .select()
    .from(schema.pushSubscription)
    .where(eq(schema.pushSubscription.organizationId, organizationId));

  const nombre = nombreContacto?.trim().slice(0, 70);
  const titulo = nombre ? `Nuevo mensaje de ${nombre}` : "Nuevo mensaje";

  await Promise.all(
    filas.map(async (fila) => {
      let subscription: SuscripcionWebPush;
      try {
        subscription = JSON.parse(
          decryptSecret({
            cipher: fila.payloadCipher,
            iv: fila.payloadIv,
            tag: fila.payloadTag,
          })
        ) as SuscripcionWebPush;
      } catch {
        // Una fila corrupta no impide avisar a los otros dispositivos.
        console.warn("[push] suscripción cifrada ilegible; se omite el envío");
        return;
      }

      try {
        await webpush.sendNotification(
          subscription as WebPushSubscription,
          JSON.stringify({
            title: titulo,
            body: "Tienes un mensaje nuevo en tu bandeja.",
          }),
          { TTL: 90 }
        );
      } catch (error) {
        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error
            ? Number((error as { statusCode?: unknown }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          await db
            .delete(schema.pushSubscription)
            .where(eq(schema.pushSubscription.id, fila.id));
          return;
        }
        console.warn(`[push] no se pudo entregar un aviso (HTTP ${statusCode || "?"})`);
      }
    })
  );
}
