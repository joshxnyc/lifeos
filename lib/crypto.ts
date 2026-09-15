import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { serverEnv } from "@/lib/env";

// App-level AES-256-GCM for OAuth tokens at rest (SPEC §3: never store
// refresh tokens in plaintext). Format: base64(iv | ciphertext | authTag).

function key(): Buffer {
  const k = Buffer.from(serverEnv().TOKEN_ENCRYPTION_KEY, "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes base64");
  return k;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, enc, cipher.getAuthTag()]).toString("base64");
}

export function decryptToken(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const enc = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
