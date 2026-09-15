import "server-only";
import { google, type Auth } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { markNeedsReauth, safeErrorMessage } from "@/lib/integrations/accounts";
import type { ConnectedAccount } from "@/lib/types";

/**
 * Google OAuth per account (SPEC §6.1). Scopes are exactly these four —
 * CLAUDE.md §4 hard rule: never request Gmail scopes beyond read-only, so
 * gmail.modify / gmail.send must never appear here.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
] as const;

export function googleRedirectUri(): string {
  return `${serverEnv().APP_URL.replace(/\/$/, "")}/api/auth/google/callback`;
}

export function googleConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** A bare OAuth2 client for the connect flow (no credentials attached). */
export function newOAuthClient(): Auth.OAuth2Client {
  const env = serverEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  }
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, googleRedirectUri());
}

/** True when the error is Google telling us the refresh token is dead. */
export function isInvalidGrant(err: unknown): boolean {
  const e = err as { message?: string; response?: { data?: { error?: string } } };
  const body = e?.response?.data?.error ?? "";
  return /invalid_grant/i.test(`${e?.message ?? ""} ${body}`);
}

/** HTTP status from a googleapis error, when there is one. */
export function errorStatus(err: unknown): number | null {
  const e = err as { code?: number | string; status?: number; response?: { status?: number } };
  const raw = e?.response?.status ?? e?.status ?? e?.code;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * CONTRACTS §A4. Returns an OAuth2 client for this account with tokens
 * decrypted, a refresh handler that persists rotated tokens (encrypted), and
 * invalid_grant handling: status → needs_reauth, one push per day, then throw.
 */
export async function getGoogleClientForAccount(
  supabase: SupabaseClient,
  account: ConnectedAccount,
): Promise<Auth.OAuth2Client> {
  const client = newOAuthClient();

  const access = account.access_token_enc ? decryptToken(account.access_token_enc) : undefined;
  const refresh = account.refresh_token_enc ? decryptToken(account.refresh_token_enc) : undefined;
  if (!refresh && !access) {
    await markNeedsReauth(supabase, account, "No stored Google credentials");
    throw new Error(`${account.label}: no stored credentials`);
  }

  client.setCredentials({
    access_token: access,
    refresh_token: refresh,
    expiry_date: account.token_expires_at ? Date.parse(account.token_expires_at) : undefined,
  });

  // google-auth-library emits `tokens` after every silent refresh; persist the
  // rotated access token (and a rotated refresh token, if Google sends one).
  client.on("tokens", (tokens) => {
    void persistTokens(supabase, account.id, tokens).catch((err) =>
      console.error("persist google tokens", safeErrorMessage(err)),
    );
  });

  const expiresAt = account.token_expires_at ? Date.parse(account.token_expires_at) : 0;
  const stale = !access || !expiresAt || expiresAt - Date.now() < 60_000;
  if (stale && refresh) {
    try {
      await client.getAccessToken(); // triggers refresh + the tokens event
    } catch (err) {
      if (isInvalidGrant(err)) {
        await markNeedsReauth(
          supabase,
          account,
          "Google refused the refresh token (invalid_grant). Reconnect the account.",
        );
      }
      throw err;
    }
  }

  return client;
}

async function persistTokens(
  supabase: SupabaseClient,
  accountId: string,
  tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (tokens.access_token) patch.access_token_enc = encryptToken(tokens.access_token);
  if (tokens.refresh_token) patch.refresh_token_enc = encryptToken(tokens.refresh_token);
  if (tokens.expiry_date) patch.token_expires_at = new Date(tokens.expiry_date).toISOString();
  if (!Object.keys(patch).length) return;
  await supabase.from("connected_accounts").update(patch).eq("id", accountId);
}
