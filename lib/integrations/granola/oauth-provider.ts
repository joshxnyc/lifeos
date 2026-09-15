import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { serverEnv } from "@/lib/env";
import { decryptToken, encryptToken } from "@/lib/crypto";
import type { ConnectedAccount } from "@/lib/types";

/**
 * MCP OAuth 2.0 with Dynamic Client Registration (SPEC §6.3), persisted in the
 * connected_accounts row for provider 'granola':
 *   access_token_enc / refresh_token_enc / token_expires_at — the tokens
 *   sync_state.mcp_client_info                              — the DCR registration
 *   sync_state.mcp_code_verifier                            — PKCE, one flow long
 *
 * Tokens are only ever written through lib/crypto and never logged.
 */

export const GRANOLA_MCP_URL = "https://mcp.granola.ai/mcp";

export function granolaRedirectUri(): string {
  return `${serverEnv().APP_URL.replace(/\/$/, "")}/api/auth/granola/callback`;
}

interface GranolaSyncState {
  mcp_client_info?: OAuthClientInformationMixed;
  mcp_code_verifier?: string;
  created_after?: string;
  [key: string]: unknown;
}

export class GranolaOAuthProvider implements OAuthClientProvider {
  private state: GranolaSyncState;

  constructor(
    private readonly supabase: SupabaseClient,
    private account: ConnectedAccount,
    private readonly onRedirect?: (url: URL) => void,
  ) {
    this.state = (account.sync_state ?? {}) as GranolaSyncState;
  }

  get redirectUrl(): string {
    return granolaRedirectUri();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "LifeOS",
      client_uri: serverEnv().APP_URL,
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.state.mcp_client_info;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    await this.patchState({ mcp_client_info: info });
  }

  tokens(): OAuthTokens | undefined {
    if (!this.account.access_token_enc) return undefined;
    const expiresAt = this.account.token_expires_at ? Date.parse(this.account.token_expires_at) : null;
    return {
      access_token: decryptToken(this.account.access_token_enc),
      token_type: "Bearer",
      refresh_token: this.account.refresh_token_enc
        ? decryptToken(this.account.refresh_token_enc)
        : undefined,
      expires_in: expiresAt ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : undefined,
    };
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const patch: Record<string, unknown> = {
      access_token_enc: encryptToken(tokens.access_token),
      status: "active",
      last_error: null,
    };
    if (tokens.refresh_token) patch.refresh_token_enc = encryptToken(tokens.refresh_token);
    patch.token_expires_at = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    const { data } = await this.supabase
      .from("connected_accounts")
      .update(patch)
      .eq("id", this.account.id)
      .select("*")
      .single();
    if (data) this.account = data as ConnectedAccount;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Route handlers cannot "redirect the user agent" from inside the SDK, so
    // the caller captures the URL and returns it as a 302.
    this.onRedirect?.(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.patchState({ mcp_code_verifier: codeVerifier });
  }

  codeVerifier(): string {
    const verifier = this.state.mcp_code_verifier;
    if (!verifier) throw new Error("No PKCE code verifier stored — restart the Granola connect flow");
    return verifier;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    if (scope === "verifier") return this.patchState({ mcp_code_verifier: undefined });
    if (scope === "client" || scope === "all") await this.patchState({ mcp_client_info: undefined });
    if (scope === "tokens" || scope === "all") {
      await this.supabase
        .from("connected_accounts")
        .update({ access_token_enc: null, refresh_token_enc: null, token_expires_at: null })
        .eq("id", this.account.id);
    }
  }

  private async patchState(patch: Partial<GranolaSyncState>): Promise<void> {
    this.state = { ...this.state, ...patch };
    await this.supabase
      .from("connected_accounts")
      .update({ sync_state: this.state })
      .eq("id", this.account.id);
  }
}

/** The single Granola account row; created on first connect or first sync. */
export async function ensureGranolaAccount(
  supabase: SupabaseClient,
  userId: string,
  label = "Granola",
): Promise<ConnectedAccount> {
  const { data: existing } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "granola")
    .maybeSingle();
  if (existing) return existing as ConnectedAccount;

  const { data, error } = await supabase
    .from("connected_accounts")
    .insert({
      user_id: userId,
      provider: "granola",
      label,
      external_identity: "granola",
      status: "needs_reauth",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`ensureGranolaAccount: ${error?.message ?? "insert failed"}`);
  return data as ConnectedAccount;
}
