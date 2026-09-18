import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GOOGLE_SCOPES, googleConfigured, newOAuthClient } from "@/lib/integrations/google/client";
import { GOOGLE_STATE_COOKIE, newNonce, signState } from "@/lib/integrations/google/oauth-state";

/**
 * Settings → "Connect Google account" (SPEC §6.1). The same route serves the
 * first Google account and the fifth — accounts are rows, not config.
 * access_type=offline + prompt=consent is what returns a refresh token on
 * every connect, including reconnects after a needs_reauth.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/settings?error=google_not_configured", req.url));
  }

  // Reconnect (?account=<id>): pre-select the identity being repaired, so a
  // browser signed into several Google accounts doesn't quietly re-consent
  // the wrong one and leave the dead row stuck on needs_reauth.
  let loginHint: string | undefined;
  const accountId = req.nextUrl.searchParams.get("account");
  if (accountId) {
    const { data } = await supabase
      .from("connected_accounts")
      .select("external_identity")
      .eq("id", accountId)
      .eq("provider", "google")
      .maybeSingle();
    loginHint = (data?.external_identity as string | undefined) || undefined;
  }

  const nonce = newNonce();
  const url = newOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: [...GOOGLE_SCOPES],
    state: signState(nonce),
    ...(loginHint ? { login_hint: loginHint } : {}),
  });

  const res = NextResponse.redirect(url);
  res.cookies.set(GOOGLE_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
