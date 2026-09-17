import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";

/**
 * The VAPID *public* key — not a secret; it is embedded in every push
 * subscription the browser hands out. The service worker fetches it here when
 * it must re-subscribe after a push-service rotation and has no open page (and
 * no IndexedDB copy) to hand it the key. Middleware still gates this route
 * behind the session cookie, which costs nothing: /api/push/subscribe requires
 * the same session anyway, so a signed-out worker could not register a row
 * even with the key.
 */
export async function GET() {
  const key = serverEnv().VAPID_PUBLIC_KEY;
  if (!key) return NextResponse.json({ error: "VAPID_PUBLIC_KEY is not set" }, { status: 404 });
  return NextResponse.json({ key });
}
