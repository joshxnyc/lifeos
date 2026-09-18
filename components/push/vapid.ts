// Shared between the page (enable-push.tsx) and the service worker (app/sw.ts):
// VAPID key handling, the device label, and the small IndexedDB pocket the SW
// reads the public key from when the push service rotates a subscription while
// no page is open. No "use client" — this must import cleanly in worker scope.

const DB_NAME = "lifeos-push";
const STORE = "kv";
const VAPID_KEY = "vapid-public-key";

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
export function toApplicationServerKey(base64: string): ArrayBuffer {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

/** "iPhone · Safari" — navigator.userAgent exists in window and worker scope. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Macintosh/.test(ua)
        ? "Mac"
        : /Android/.test(ua)
          ? "Android"
          : /Windows/.test(ua)
            ? "Windows"
            : "Browser";
  const browser = /CriOS|Chrome/.test(ua)
    ? "Chrome"
    : /Firefox/.test(ua)
      ? "Firefox"
      : /Safari/.test(ua)
        ? "Safari"
        : "Browser";
  return `${device} · ${browser}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Best-effort: the SW has two other ways to find the key (see sw.ts). */
export async function storeVapidPublicKey(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(key, VAPID_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB unavailable (private mode, cleared data) — not fatal
  }
}

export async function readVapidPublicKey(): Promise<string | null> {
  try {
    const db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(VAPID_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}
