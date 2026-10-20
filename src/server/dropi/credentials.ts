import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type {
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
  Tool,
} from "@modelcontextprotocol/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

const DEFAULT_ISSUER = "__default__";
const FLOW_TTL_MS = 15 * 60 * 1000;

export type DropiToolSnapshot = Pick<Tool, "name" | "description" | "inputSchema" | "annotations">;
export type DropiOAuthBundle = {
  latestIssuer?: string;
  clientInformationByIssuer: Record<string, StoredOAuthClientInformation>;
  tokensByIssuer: Record<string, StoredOAuthTokens>;
  discoveryState?: OAuthDiscoveryState;
  tools?: DropiToolSnapshot[];
};
type FlowData = {
  state: string;
  codeVerifier?: string;
  authorizationUrl?: string;
  bundle?: DropiOAuthBundle;
};

const EMPTY_BUNDLE = (): DropiOAuthBundle => ({
  clientInformationByIssuer: {},
  tokensByIssuer: {},
});

function issuerKey(issuer?: string) {
  return issuer ?? DEFAULT_ISSUER;
}

export async function getDropiConnection(organizationId: string) {
  const db = getDb();
  const rows = await db.select().from(schema.dropiCredentials).where(
    scoped(schema.dropiCredentials.organizationId, organizationId)
  ).limit(1);
  const row = rows[0];
  if (!row) return null;
  let bundle: DropiOAuthBundle;
  try {
    bundle = JSON.parse(decryptSecret({
      cipher: row.oauthCipher,
      iv: row.oauthIv,
      tag: row.oauthTag,
    })) as DropiOAuthBundle;
  } catch {
    return { ...row, bundle: EMPTY_BUNDLE() };
  }
  return { ...row, bundle };
}

export async function saveDropiToolSnapshot(organizationId: string, tools: DropiToolSnapshot[]) {
  await updateBundle(organizationId, (bundle) => { bundle.tools = tools; });
}

async function saveBundle(organizationId: string, bundle: DropiOAuthBundle) {
  const db = getDb();
  const encrypted = encryptSecret(JSON.stringify(bundle));
  const values = {
    oauthCipher: encrypted.cipher,
    oauthIv: encrypted.iv,
    oauthTag: encrypted.tag,
    status: "connected" as const,
    lastError: null,
    updatedAt: new Date(),
  };
  await db.insert(schema.dropiCredentials).values({
    id: newId("dropiCredentials"),
    organizationId,
    ...values,
  }).onConflictDoUpdate({
    target: [schema.dropiCredentials.organizationId],
    set: values,
  });
}

async function updateBundle(
  organizationId: string,
  update: (bundle: DropiOAuthBundle) => void
) {
  const connection = await getDropiConnection(organizationId);
  const bundle = connection?.bundle ?? EMPTY_BUNDLE();
  update(bundle);
  await saveBundle(organizationId, bundle);
}

export async function saveDropiClientInformation(
  organizationId: string,
  info: StoredOAuthClientInformation,
  issuer?: string
) {
  await updateBundle(organizationId, (bundle) => {
    const key = issuerKey(issuer ?? info.issuer);
    bundle.clientInformationByIssuer[key] = info;
    bundle.latestIssuer = issuer ?? info.issuer ?? bundle.latestIssuer;
  });
}

export async function saveDropiTokens(
  organizationId: string,
  tokens: StoredOAuthTokens,
  issuer?: string
) {
  await updateBundle(organizationId, (bundle) => {
    const key = issuerKey(issuer ?? tokens.issuer ?? bundle.latestIssuer);
    bundle.tokensByIssuer[key] = tokens;
    bundle.latestIssuer = issuer ?? tokens.issuer ?? bundle.latestIssuer;
  });
}

export async function saveDropiDiscovery(
  organizationId: string,
  discoveryState: OAuthDiscoveryState
) {
  await updateBundle(organizationId, (bundle) => {
    bundle.discoveryState = discoveryState;
  });
}

export async function getDropiOAuthBundle(organizationId: string) {
  return (await getDropiConnection(organizationId))?.bundle ?? EMPTY_BUNDLE();
}

export async function replaceDropiOAuthBundle(organizationId: string, bundle: DropiOAuthBundle) {
  await saveBundle(organizationId, bundle);
}

export async function findDropiFlowByState(state: string) {
  const db = getDb();
  const digest = createHash("sha256").update(state).digest("hex");
  const rows = await db.select().from(schema.dropiOAuthFlow).where(and(
    eq(schema.dropiOAuthFlow.stateHash, digest),
    isNull(schema.dropiOAuthFlow.consumedAt),
    gt(schema.dropiOAuthFlow.expiresAt, new Date())
  )).limit(1);
  return rows[0] ?? null;
}

export async function getDropiFlowById(flowId: string, organizationId: string) {
  return getDropiFlowData(flowId, organizationId);
}

export async function getDropiFlowOwner(flowId: string) {
  const db = getDb();
  const rows = await db.select({
    organizationId: schema.dropiOAuthFlow.organizationId,
    actorUserId: schema.dropiOAuthFlow.actorUserId,
  }).from(schema.dropiOAuthFlow).where(eq(schema.dropiOAuthFlow.id, flowId)).limit(1);
  return rows[0] ?? null;
}

export async function saveDropiFlowBundle(flowId: string, organizationId: string, bundle: DropiOAuthBundle) {
  await updateDropiFlowData(flowId, organizationId, (flow) => { flow.bundle = bundle; });
}

export async function consumeDropiFlowByState(flowId: string, organizationId: string, actorUserId: string, state: string) {
  const flow = await consumeDropiOAuthFlow(flowId, organizationId, actorUserId, state);
  return flow;
}

export async function saveDropiTools(organizationId: string, tools: DropiToolSnapshot[]) {
  await updateBundle(organizationId, (bundle) => {
    bundle.tools = tools;
  });
}

export async function setDropiErrorIfCredentialsUnchanged(
  organizationId: string,
  oauthCipher: string,
  message: string
) {
  const db = getDb();
  await db.update(schema.dropiCredentials).set({
    status: "error",
    lastError: message.slice(0, 500),
    updatedAt: new Date(),
  }).where(and(
    scoped(schema.dropiCredentials.organizationId, organizationId),
    eq(schema.dropiCredentials.oauthCipher, oauthCipher)
  ));
}

export async function removeDropiConnection(organizationId: string) {
  const db = getDb();
  await db.delete(schema.dropiCredentials).where(
    scoped(schema.dropiCredentials.organizationId, organizationId)
  );
}

export async function updateDropiSettings(
  organizationId: string,
  input: { rateType: "CON RECAUDO" | "SIN RECAUDO" | null; orderCreationEnabled: boolean }
) {
  const db = getDb();
  await db.update(schema.dropiCredentials).set({
    rateType: input.rateType,
    orderCreationEnabled: input.orderCreationEnabled,
    updatedAt: new Date(),
  }).where(scoped(schema.dropiCredentials.organizationId, organizationId));
}

export async function createDropiOAuthFlow(
  organizationId: string,
  actorUserId: string
) {
  const db = getDb();
  const id = newId("dropiOAuthFlow");
  const state = randomBytes(32).toString("base64url");
  const encrypted = encryptSecret(JSON.stringify({ state } satisfies FlowData));
  await db.insert(schema.dropiOAuthFlow).values({
    id,
    organizationId,
    actorUserId,
    stateHash: createHash("sha256").update(state).digest("hex"),
    flowCipher: encrypted.cipher,
    flowIv: encrypted.iv,
    flowTag: encrypted.tag,
    expiresAt: new Date(Date.now() + FLOW_TTL_MS),
  });
  return { id, state };
}

async function flowRow(flowId: string, organizationId: string, actorUserId?: string) {
  const db = getDb();
  const rows = await db.select().from(schema.dropiOAuthFlow).where(and(
    eq(schema.dropiOAuthFlow.id, flowId),
    scoped(schema.dropiOAuthFlow.organizationId, organizationId),
    ...(actorUserId ? [eq(schema.dropiOAuthFlow.actorUserId, actorUserId)] : []),
    isNull(schema.dropiOAuthFlow.consumedAt),
    gt(schema.dropiOAuthFlow.expiresAt, new Date())
  )).limit(1);
  return rows[0] ?? null;
}

export async function getDropiFlowData(
  flowId: string,
  organizationId: string,
  actorUserId?: string
): Promise<FlowData | null> {
  const row = await flowRow(flowId, organizationId, actorUserId);
  if (!row) return null;
  try {
    return JSON.parse(decryptSecret({
      cipher: row.flowCipher,
      iv: row.flowIv,
      tag: row.flowTag,
    })) as FlowData;
  } catch {
    return null;
  }
}

export async function updateDropiFlowData(
  flowId: string,
  organizationId: string,
  update: (flow: FlowData) => void
) {
  const row = await flowRow(flowId, organizationId);
  if (!row) throw new Error("El flujo de autorización expiró.");
  const flow = JSON.parse(decryptSecret({
    cipher: row.flowCipher,
    iv: row.flowIv,
    tag: row.flowTag,
  })) as FlowData;
  update(flow);
  const encrypted = encryptSecret(JSON.stringify(flow));
  const db = getDb();
  await db.update(schema.dropiOAuthFlow).set({
    flowCipher: encrypted.cipher,
    flowIv: encrypted.iv,
    flowTag: encrypted.tag,
  }).where(and(
    eq(schema.dropiOAuthFlow.id, flowId),
    scoped(schema.dropiOAuthFlow.organizationId, organizationId),
    isNull(schema.dropiOAuthFlow.consumedAt)
  ));
}

export async function consumeDropiOAuthFlow(
  flowId: string,
  organizationId: string,
  actorUserId: string,
  state: string
) {
  const db = getDb();
  const digest = createHash("sha256").update(state).digest("hex");
  const consumed = await db.update(schema.dropiOAuthFlow).set({ consumedAt: new Date() })
    .where(and(
      eq(schema.dropiOAuthFlow.id, flowId),
      scoped(schema.dropiOAuthFlow.organizationId, organizationId),
      eq(schema.dropiOAuthFlow.actorUserId, actorUserId),
      eq(schema.dropiOAuthFlow.stateHash, digest),
      isNull(schema.dropiOAuthFlow.consumedAt),
      gt(schema.dropiOAuthFlow.expiresAt, new Date())
    )).returning();
  const row = consumed[0];
  if (!row) throw new Error("El flujo OAuth expiró o el estado no coincide.");
  return JSON.parse(decryptSecret({
    cipher: row.flowCipher,
    iv: row.flowIv,
    tag: row.flowTag,
  })) as FlowData;
}

export async function deleteDropiOAuthFlow(flowId: string, organizationId: string) {
  const db = getDb();
  await db.delete(schema.dropiOAuthFlow).where(and(
    eq(schema.dropiOAuthFlow.id, flowId),
    scoped(schema.dropiOAuthFlow.organizationId, organizationId)
  ));
}

export async function getDropiTokens(organizationId: string) {
  const bundle = await getDropiOAuthBundle(organizationId);
  const key = bundle.latestIssuer ?? DEFAULT_ISSUER;
  return bundle.tokensByIssuer[key] ?? bundle.tokensByIssuer[DEFAULT_ISSUER] ?? null;
}
