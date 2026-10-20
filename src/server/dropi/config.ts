import { getEnv } from "@/lib/env";

export const DROPi_RESOURCE_URL = "https://mcp.dropi.co/mcp";
export const DROPi_AUTHORIZATION_ORIGIN = "https://oauth.dropi.co";

export function dropiConfig() {
  const env = getEnv();
  const mcpUrl = new URL(env.DROPI_MCP_URL);
  if (mcpUrl.origin !== new URL(DROPi_RESOURCE_URL).origin || mcpUrl.pathname !== "/mcp") {
    throw new Error("La URL del MCP de Dropi no coincide con el recurso permitido.");
  }
  const appUrl = new URL(env.APP_BASE_URL);
  if (appUrl.protocol !== "https:" && appUrl.hostname !== "localhost") {
    throw new Error("APP_BASE_URL debe usar HTTPS para conectar Dropi.");
  }
  return {
    mcpUrl,
    callbackUrl: new URL("/api/dropi/callback", appUrl),
    // Dropi publica un issuer que no coincide con el recurso protegido MCP.
    // La compatibilidad se permite porque el recurso y el redirect OAuth se
    // validan contra los hosts oficiales exactos en oauth-provider.ts.
    skipIssuerMetadataValidation: true,
  };
}

export function dropiConfigStatus() {
  try {
    const config = dropiConfig();
    return {
      ready: true as const,
      callbackUrl: config.callbackUrl.toString(),
      issuerValidation: config.skipIssuerMetadataValidation ? "compatibility" : "strict",
    };
  } catch (error) {
    return {
      ready: false as const,
      message: error instanceof Error ? error.message : "Configuración de Dropi inválida",
    };
  }
}
