import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { dropiConfig } from "./config";
import {
  getDropiFlowById,
  saveDropiFlowBundle,
  getDropiOAuthBundle,
  replaceDropiOAuthBundle,
  updateDropiFlowData,
} from "./credentials";
import type { DropiOAuthBundle } from "./credentials";

export class DropiOAuthProvider implements OAuthClientProvider {
  authorizationUrl?: URL;
  private flowBundle: DropiOAuthBundle = {
    clientInformationByIssuer: {}, tokensByIssuer: {},
  };
  constructor(private readonly flowId: string, private readonly organizationId: string) {}

  get redirectUrl() { return dropiConfig().callbackUrl.toString(); }
  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      client_name: "Vocero CRM", scope: "mcp",
    };
  }
  async state() { return (await getDropiFlowById(this.flowId, this.organizationId))?.state ?? ""; }
  async clientInformation(ctx?: OAuthClientInformationContext) {
    const flow = await getDropiFlowById(this.flowId, this.organizationId);
    this.flowBundle = flow?.bundle ?? await getDropiOAuthBundle(this.organizationId);
    const key = ctx?.issuer ?? this.flowBundle.latestIssuer ?? "__default__";
    return this.flowBundle.clientInformationByIssuer[key];
  }
  async saveClientInformation(info: StoredOAuthClientInformation, ctx?: OAuthClientInformationContext) {
    this.flowBundle.clientInformationByIssuer[ctx?.issuer ?? info.issuer ?? "__default__"] = info;
    this.flowBundle.latestIssuer = ctx?.issuer ?? info.issuer ?? this.flowBundle.latestIssuer;
    await this.saveBundle();
  }
  async tokens(ctx?: OAuthClientInformationContext) {
    const flow = await getDropiFlowById(this.flowId, this.organizationId);
    this.flowBundle = flow?.bundle ?? await getDropiOAuthBundle(this.organizationId);
    const key = ctx?.issuer ?? this.flowBundle.latestIssuer ?? "__default__";
    return this.flowBundle.tokensByIssuer[key] ?? this.flowBundle.tokensByIssuer.__default__;
  }
  async saveTokens(tokens: StoredOAuthTokens, ctx?: OAuthClientInformationContext) {
    const key = ctx?.issuer ?? tokens.issuer ?? this.flowBundle.latestIssuer ?? "__default__";
    this.flowBundle.tokensByIssuer[key] = tokens;
    this.flowBundle.latestIssuer = key;
    await this.saveBundle();
  }
  async redirectToAuthorization(url: URL) {
    if (url.protocol !== "https:" || url.origin !== "https://oauth.dropi.co") {
      throw new Error("Dropi devolvió una dirección OAuth no confiable.");
    }
    this.authorizationUrl = url;
    await updateDropiFlowData(this.flowId, this.organizationId, (flow) => { flow.authorizationUrl = url.toString(); });
  }
  async saveCodeVerifier(value: string) {
    await updateDropiFlowData(this.flowId, this.organizationId, (flow) => { flow.codeVerifier = value; });
  }
  async codeVerifier() {
    return (await getDropiFlowById(this.flowId, this.organizationId))?.codeVerifier ?? "";
  }
  async validateResourceURL(serverUrl: string | URL, resource?: string) {
    const expected = new URL("https://mcp.dropi.co/mcp");
    const server = new URL(serverUrl);
    const target = resource ? new URL(resource) : server;
    if (server.origin !== expected.origin || server.pathname !== expected.pathname || target.origin !== expected.origin || target.pathname !== expected.pathname) {
      throw new Error("El recurso OAuth no coincide con el MCP oficial de Dropi.");
    }
    return expected;
  }
  async saveDiscoveryState(state: OAuthDiscoveryState) {
    this.flowBundle.discoveryState = state;
    await this.saveBundle();
  }
  async discoveryState() {
    const flow = await getDropiFlowById(this.flowId, this.organizationId);
    this.flowBundle = flow?.bundle ?? await getDropiOAuthBundle(this.organizationId);
    return this.flowBundle.discoveryState;
  }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") this.flowBundle.clientInformationByIssuer = {};
    if (scope === "all" || scope === "tokens") this.flowBundle.tokensByIssuer = {};
    if (scope === "all" || scope === "discovery") this.flowBundle.discoveryState = undefined;
    if (scope === "all" || scope === "verifier") await updateDropiFlowData(this.flowId, this.organizationId, (flow) => { delete flow.codeVerifier; });
    await this.saveBundle();
  }
  async persistToOrganization() {
    await replaceDropiOAuthBundle(this.organizationId, this.flowBundle);
  }
  private async saveBundle() {
    await saveDropiFlowBundle(this.flowId, this.organizationId, this.flowBundle);
  }
}

