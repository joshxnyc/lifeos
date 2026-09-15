import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// Refreshes the Supabase session cookie, gates every app route behind auth,
// and sets the CSP with a per-request script nonce (no 'unsafe-inline').
// /api/jobs/* authenticates via JOBS_SECRET instead; /login and PWA assets
// are public.

function cspFor(nonce: string): string {
  const supabaseOrigin = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
    } catch {
      return "";
    }
  })();
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // strict-dynamic lets nonce'd Next bootstrap scripts load their chunks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin} ${supabaseOrigin.replace("https://", "wss://")}`,
    "media-src 'self' blob:",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export async function middleware(request: NextRequest) {
  // Middleware runs on the Edge runtime: Web APIs only, no Node Buffer.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // Fail safe, never with a 500: if Supabase is unreachable or the env vars
  // are missing/misnamed, treat the visitor as signed out. Every app page
  // re-checks auth server-side, so failing toward /login loses nothing.
  let user: { id: string } | null = null;
  let supabase: ReturnType<typeof createServerClient> | null = null;
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      "";
    supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (err) {
    console.error("middleware auth check failed:", err instanceof Error ? err.message : err);
  }

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/jobs") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/manifest.webmanifest";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  // Single-user app: when OWNER_USER_ID is pinned, nobody else gets past
  // login even with a valid Supabase session (signups should also be
  // disabled in the Supabase dashboard).
  const owner = process.env.OWNER_USER_ID;
  if (user && owner && user.id !== owner && !isPublic) {
    await supabase?.auth.signOut().catch(() => {});
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/today";
    return NextResponse.redirect(url);
  }
  response.headers.set("Content-Security-Policy", cspFor(nonce));
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the service worker.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|icons|.*\\.(?:svg|png|jpg|jpeg|webp|woff2)$).*)",
  ],
};
