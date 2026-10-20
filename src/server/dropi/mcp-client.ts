import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/client";
import { getSql } from "@/lib/db";
import { dropiConfig } from "./config";
import { createDropiOAuthFlow, getDropiFlowById, saveDropiToolSnapshot, consumeDropiFlowByState, setDropiErrorIfCredentialsUnchanged } from "./credentials";
import { DropiOAuthProvider } from "./oauth-provider";

function clientFor(provider: DropiOAuthProvider) {
  const client = new Client({ name: "vocero-crm", version: "1.6.0" }, { versionNegotiation: { mode: "legacy" } });
  const transport = new StreamableHTTPClientTransport(dropiConfig().mcpUrl, {
    authProvider: provider,
    skipIssuerMetadataValidation: dropiConfig().skipIssuerMetadataValidation,
    redirectPolicy: "same-origin",
  });
  return { client, transport };
}

export async function beginDropiAuthorization(organizationId: string, userId: string) {
  const flow = await createDropiOAuthFlow(organizationId, userId);
  const provider = new DropiOAuthProvider(flow.id, organizationId);
  const { client, transport } = clientFor(provider);
  try {
    await client.connect(transport);
    return { connected: true } as const;
  } catch (error) {
    if (provider.authorizationUrl && UnauthorizedError.isInstance(error)) {
      return { connected: false, authorizationUrl: provider.authorizationUrl.toString() } as const;
    }
    throw error;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function completeDropiAuthorization(organizationId: string, userId: string, callback: URLSearchParams) {
  const state = callback.get("state");
  if (!state) throw new Error("Dropi no devolvió el estado OAuth.");
  const flowRow = await import("@/lib/db").then(async ({ getDb, schema }) => {
    const { eq, and, gt, isNull } = await import("drizzle-orm");
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(state).digest("hex");
    const rows = await getDb().select().from(schema.dropiOAuthFlow).where(and(
      eq(schema.dropiOAuthFlow.stateHash, digest),
      eq(schema.dropiOAuthFlow.organizationId, organizationId),
      eq(schema.dropiOAuthFlow.actorUserId, userId),
      isNull(schema.dropiOAuthFlow.consumedAt),
      gt(schema.dropiOAuthFlow.expiresAt, new Date())
    )).limit(1);
    return rows[0] ?? null;
  });
  if (!flowRow) throw new Error("La autorización Dropi expiró o no pertenece a este usuario.");
  const flow = await getDropiFlowById(flowRow.id, organizationId);
  if (!flow || flow.state !== state) throw new Error("El estado de autorización de Dropi no coincide.");
  const provider = new DropiOAuthProvider(flowRow.id, organizationId);
  const transport = new StreamableHTTPClientTransport(dropiConfig().mcpUrl, {
    authProvider: provider,
    skipIssuerMetadataValidation: dropiConfig().skipIssuerMetadataValidation,
    redirectPolicy: "same-origin",
  });
  try {
    await transport.finishAuth(callback);
    const client = new Client({ name: "vocero-crm", version: "1.6.0" }, { versionNegotiation: { mode: "legacy" } });
    await client.connect(transport);
    const listed = await client.listTools();
    const names = new Set(listed.tools.map((tool) => tool.name));
    if (!names.has("create_order") || !names.has("get_order")) {
      throw new Error("El MCP Dropi no ofrece las herramientas necesarias para crear y verificar pedidos.");
    }
    await provider.persistToOrganization();
    await saveDropiToolSnapshot(organizationId, listed.tools.map((tool) => ({
      name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations,
    })));
    await client.close().catch(() => undefined);
    await consumeDropiFlowByState(flowRow.id, organizationId, userId, state);
    return listed.tools.map((tool) => tool.name);
  } finally {
    await transport.close().catch(() => undefined);
  }
}

export async function listDropiTools(organizationId: string): Promise<Tool[]> {
  return withDropiClient(organizationId, async (client) => (await client.listTools()).tools);
}

export async function callDropiTool(organizationId: string, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const tools = await listDropiTools(organizationId);
  if (!tools.some((tool) => tool.name === name)) throw new Error(`Dropi no expone la herramienta ${name}.`);
  return withDropiClient(organizationId, (client) => client.callTool({ name, arguments: args }));
}

export async function callDropiTools(
  organizationId: string,
  name: string,
  argsList: Array<Record<string, unknown>>
): Promise<Array<CallToolResult | null>> {
  return withDropiClient(organizationId, async (client) => {
    const tools = (await client.listTools()).tools;
    if (!tools.some((tool) => tool.name === name)) throw new Error(`Dropi no expone la herramienta ${name}.`);
    const results: Array<CallToolResult | null> = [];
    for (const args of argsList) {
      try {
        results.push(await client.callTool({ name, arguments: args }));
      } catch {
        // Un pedido sin detalle no debe impedir la sincronización de los demás.
        results.push(null);
      }
    }
    return results;
  });
}

export async function callDropiToolPages(
  organizationId: string,
  name: string,
  argsForPage: (page: number) => Record<string, unknown>,
  hasMore: (result: CallToolResult) => boolean,
  maxPages = 100
): Promise<CallToolResult[]> {
  return withDropiClient(organizationId, async (client) => {
    const tools = (await client.listTools()).tools;
    if (!tools.some((tool) => tool.name === name)) throw new Error(`Dropi no expone la herramienta ${name}.`);
    const pages: CallToolResult[] = [];
    for (let page = 0; page < maxPages; page += 1) {
      const result = await client.callTool({ name, arguments: argsForPage(page) });
      if (result.isError) throw new Error(`Dropi falló al consultar la página ${page + 1} de pedidos.`);
      pages.push(result);
      if (!hasMore(result)) return pages;
    }
    throw new Error(`La lista de pedidos de Dropi excede el límite seguro de ${maxPages * 100} registros por sincronización.`);
  });
}

async function withDropiClient<T>(organizationId: string, task: (client: Client) => Promise<T>): Promise<T> {
  // Dropi may rotate refresh tokens. A database advisory lock makes refresh and
  // credential persistence single-file across all app instances, not just one process.
  const sql = getSql();
  const connection = await sql.reserve();
  let lockAcquired = false;
  try {
    await connection`SELECT pg_advisory_lock(hashtextextended(${organizationId}, 0))`;
    lockAcquired = true;

    // Read the credentials only after the lock: a queued request must use the
    // token bundle saved by the previous request, including a rotated refresh token.
    const row = await import("@/server/dropi/credentials").then((m) => m.getDropiConnection(organizationId));
    if (!row) throw new Error("Dropi no está conectado.");
    const provider = new DropiOAuthProvider("", organizationId);
    const { client, transport } = clientFor(provider);
    try {
      await client.connect(transport);
      return await task(client);
    } catch (error) {
      const requiresReconnect = UnauthorizedError.isInstance(error) ||
        (error instanceof Error && error.message.includes("autorización de Dropi venció"));
      if (requiresReconnect) {
        // A failed request must not overwrite credentials another path has since
        // refreshed or re-authorized.
        await setDropiErrorIfCredentialsUnchanged(
          organizationId,
          row.oauthCipher,
          "La autorización de Dropi venció. Vuelve a conectar la cuenta desde Ajustes → Dropi."
        );
      }
      throw error;
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  } finally {
    if (lockAcquired) {
      await connection`SELECT pg_advisory_unlock(hashtextextended(${organizationId}, 0))`.catch(() => undefined);
    }
    connection.release();
  }
}
