import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import {
  ensureGranolaAccount,
  GranolaOAuthProvider,
  GRANOLA_MCP_URL,
  GRANOLA_STATE_COOKIE,
} from "@/lib/integrations/granola/oauth-provider";
import { newNonce } from "@/lib/integrations/oauth-state";

/**
 * Connect Granola over MCP OAuth 2.0 with Dynamic Client Registration
 * (SPEC §6.3). The SDK's auth() helper does discovery, registration and PKCE;
 * our provider persists all of it on the connected_accounts row and hands the
 * authorization URL back here so the route can return a 302.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  if (serverEnv().GRANOLA_API_KEY) {
    // A Business-plan key is present; the API adapter is already in use.
    return NextResponse.redirect(new URL("/settings?granola=api_key_in_use", req.url));
  }

  try {
    const account = await ensureGranolaAccount(supabase, user.id);
    // Held in an object so the assignment inside the callback is visible to
    // TypeScript's control flow analysis.
    const redirect: { url: URL | null } = { url: null };
    const nonce = newNonce();
    const provider = new GranolaOAuthProvider(
      supabase,
      account,
      (url) => {
        redirect.url = url;
      },
      nonce,
    );

    const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");
    const result = await auth(provider, { serverUrl: GRANOLA_MCP_URL });

    if (result === "AUTHORIZED") {
      return NextResponse.redirect(new URL("/settings?granola=connected", req.url));
    }
    if (!redirect.url) throw new Error("Granola did not return an authorization URL");

    // The signed nonce rode out in `state`; the raw one stays in the browser
    // so the callback can prove the two belong together (CSRF).
    const res = NextResponse.redirect(redirect.url.toString());
    res.cookies.set(GRANOLA_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth/granola",
      maxAge: 600,
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "granola_oauth_failed";
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(message.slice(0, 120))}`, req.url),
    );
  }
}
