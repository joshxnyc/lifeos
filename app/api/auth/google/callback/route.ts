import { NextResponse, type NextRequest } from "next/server";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/crypto";
import { GOOGLE_SCOPES, newOAuthClient } from "@/lib/integrations/google/client";
import { GOOGLE_STATE_COOKIE, stateMatches } from "@/lib/integrations/google/oauth-state";

/**
 * OAuth callback (SPEC §6.1). Stores/updates one connected_accounts row keyed
 * on the Google email, then sends Joshua to the per-account setup page to pick
 * a label, a default domain, which calendars to read and the single calendar
 * the app may write to.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const params = req.nextUrl.searchParams;
  const settings = (q: string) => NextResponse.redirect(new URL(`/settings?${q}`, req.url));

  if (params.get("error")) return settings(`error=${encodeURIComponent(params.get("error") ?? "denied")}`);

  const code = params.get("code");
  const state = params.get("state");
  const nonce = req.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  if (!code || !state || !nonce || !stateMatches(state, nonce)) {
    return settings("error=oauth_state_mismatch");
  }

  try {
    const client = newOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const me = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
    const email = me.data.email;
    if (!email) return settings("error=no_email_returned");

    const { data: existing } = await supabase
      .from("connected_accounts")
      .select("id, refresh_token_enc, label")
      .eq("user_id", user.id)
      .eq("provider", "google")
      .eq("external_identity", email)
      .maybeSingle();

    const row: Record<string, unknown> = {
      user_id: user.id,
      provider: "google",
      external_identity: email,
      access_token_enc: tokens.access_token ? encryptToken(tokens.access_token) : null,
      token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scopes: tokens.scope ? tokens.scope.split(" ") : [...GOOGLE_SCOPES],
      status: "active",
      last_error: null,
    };
    // Google only returns a refresh token on a consented connect; keep the
    // stored one if this exchange didn't include a new one.
    if (tokens.refresh_token) row.refresh_token_enc = encryptToken(tokens.refresh_token);
    else if (existing?.refresh_token_enc) row.refresh_token_enc = existing.refresh_token_enc;

    let accountId = existing?.id as string | undefined;
    if (accountId) {
      const { error } = await supabase.from("connected_accounts").update(row).eq("id", accountId);
      if (error) throw new Error(error.message);
    } else {
      row.label = email;
      const { data, error } = await supabase
        .from("connected_accounts")
        .insert(row)
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "insert failed");
      accountId = data.id as string;
    }

    const res = NextResponse.redirect(new URL(`/settings/accounts/${accountId}?connected=1`, req.url));
    res.cookies.delete(GOOGLE_STATE_COOKIE);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_failed";
    return settings(`error=${encodeURIComponent(message.slice(0, 120))}`);
  }
}
