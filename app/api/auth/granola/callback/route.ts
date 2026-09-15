import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ensureGranolaAccount,
  GranolaOAuthProvider,
  GRANOLA_MCP_URL,
} from "@/lib/integrations/granola/oauth-provider";

/**
 * Granola MCP OAuth callback (SPEC §6.3). Exchanges the code via the SDK's
 * auth() helper, which calls saveTokens() on our provider — the tokens land
 * encrypted on the connected_accounts row and the account goes active.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const code = req.nextUrl.searchParams.get("code");
  const oauthError = req.nextUrl.searchParams.get("error");
  if (oauthError || !code) {
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(oauthError ?? "granola_no_code")}`, req.url),
    );
  }

  try {
    const account = await ensureGranolaAccount(supabase, user.id);
    const provider = new GranolaOAuthProvider(supabase, account);
    const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");
    const result = await auth(provider, { serverUrl: GRANOLA_MCP_URL, authorizationCode: code });
    if (result !== "AUTHORIZED") throw new Error("Granola did not authorize the connection");
    return NextResponse.redirect(new URL("/settings?granola=connected", req.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "granola_oauth_failed";
    return NextResponse.redirect(
      new URL(`/settings?error=${encodeURIComponent(message.slice(0, 120))}`, req.url),
    );
  }
}
