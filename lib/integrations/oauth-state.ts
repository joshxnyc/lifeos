import "server-only";
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "crypto";
import { serverEnv } from "@/lib/env";

/**
 * CSRF for every OAuth connect flow (Google, Granola): a random nonce goes
 * into an httpOnly cookie, and the `state` parameter carries the nonce plus an
 * HMAC of it, so the callback checks both that the state is ours and that it
 * belongs to this browser.
 *
 * The signing key is derived from TOKEN_ENCRYPTION_KEY with HKDF rather than
 * being the key itself: state signatures and token encryption never share key
 * material.
 */

const STATE_KEY_INFO = "lifeos-oauth-state";

function signingKey(): Buffer {
  const secret = Buffer.from(serverEnv().TOKEN_ENCRYPTION_KEY, "utf8");
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), STATE_KEY_INFO, 32));
}

export function newNonce(): string {
  return randomBytes(24).toString("hex");
}

export function signState(nonce: string): string {
  const mac = createHmac("sha256", signingKey()).update(nonce).digest("hex").slice(0, 32);
  return `${nonce}.${mac}`;
}

export function stateMatches(state: string, nonce: string): boolean {
  const expected = Buffer.from(signState(nonce));
  const actual = Buffer.from(state);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
