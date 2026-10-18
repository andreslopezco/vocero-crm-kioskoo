import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

export type Credentials = {
  id: string;
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  token: string;
};

type Row = typeof schema.metaCredentials.$inferSelect;

function toCredentials(row: Row): Credentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    wabaId: row.wabaId,
    phoneNumberId: row.phoneNumberId,
    displayPhoneNumber: row.displayPhoneNumber,
    verifiedName: row.verifiedName,
    status: row.status,
    token: decryptSecret({
      cipher: row.tokenCipher,
      iv: row.tokenIv,
      tag: row.tokenTag,
    }),
  };
}

/** Resuelve la conexión por phone_number_id (enrutamiento del webhook). */
export async function getCredentialsByPhoneNumberId(
  phoneNumberId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.phoneNumberId, phoneNumberId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Resuelve la conexión por WABA ID (eventos a nivel WABA, ej. plantillas). */
export async function getCredentialsByWabaId(
  wabaId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.wabaId, wabaId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function getCredentialsByOrg(
  organizationId: string
): Promise<Credentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.metaCredentials)
    .where(scoped(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function saveCredentials(input: {
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  token: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  await db.transaction(async (tx) => {
    const previous = await tx.select({ wabaId: schema.metaCredentials.wabaId })
      .from(schema.metaCredentials)
      .where(scoped(schema.metaCredentials.organizationId, input.organizationId))
      .limit(1);
    await tx
      .insert(schema.metaCredentials)
      .values({
        id: newId("credentials"),
        organizationId: input.organizationId,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: input.displayPhoneNumber ?? null,
        verifiedName: input.verifiedName ?? null,
        tokenCipher: enc.cipher,
        tokenIv: enc.iv,
        tokenTag: enc.tag,
        status: "connected",
      })
      .onConflictDoUpdate({
        target: [schema.metaCredentials.organizationId],
        set: {
          wabaId: input.wabaId,
          phoneNumberId: input.phoneNumberId,
          displayPhoneNumber: input.displayPhoneNumber ?? null,
          verifiedName: input.verifiedName ?? null,
          tokenCipher: enc.cipher,
          tokenIv: enc.iv,
          tokenTag: enc.tag,
          status: "connected",
          updatedAt: new Date(),
        },
      });
    if (previous[0] && previous[0].wabaId !== input.wabaId) {
      await tx.delete(schema.metaCatalogProduct)
        .where(scoped(schema.metaCatalogProduct.organizationId, input.organizationId));
      await tx.delete(schema.metaCatalog)
        .where(scoped(schema.metaCatalog.organizationId, input.organizationId));
    }
  });
}

/**
 * Desconectar el número: borra las credenciales cifradas de la organización.
 *
 * No toca conversaciones, contactos ni leads — son de la organización, no de
 * la conexión. Idempotente: sin fila, no hay nada que borrar.
 */
export async function desconectarCanal(organizationId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.metaCatalogProduct)
      .where(scoped(schema.metaCatalogProduct.organizationId, organizationId));
    await tx.delete(schema.metaCatalog)
      .where(scoped(schema.metaCatalog.organizationId, organizationId));
    await tx.delete(schema.metaCredentials)
      .where(scoped(schema.metaCredentials.organizationId, organizationId));
  });
}

/** Marca la conexión como vencida (token inválido detectado en runtime). */
export async function markReconnectRequired(
  organizationId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.metaCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.metaCredentials.organizationId, organizationId));
}

/** Últimos 4 caracteres del token para mostrar en UI (jamás el token). */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}
