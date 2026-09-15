import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { serverEnv } from "@/lib/env";

/**
 * CSRF for the Google connect flow: a random nonce goes into an httpOnly
 * cookie, and the `state` parameter carries the nonce plus an HMAC of it, so
 * the callback checks both that the state is ours and that it belongs to this
 * browser.
 */
export const GOOGLE_STATE_COOKIE = "lifeos_google_oauth_state";

export function newNonce(): string {
  return randomBytes(24).toString("hex");
}

export function signState(nonce: string): string {
  const mac = createHmac("sha256", serverEnv().TOKEN_ENCRYPTION_KEY).update(nonce).digest("hex").slice(0, 32);
  return `${nonce}.${mac}`;
}

export function stateMatches(state: string, nonce: string): boolean {
  const expected = Buffer.from(signState(nonce));
  const actual = Buffer.from(state);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
