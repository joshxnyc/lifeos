"use client";

// A capture must never be lost to a dead connection (SPEC §11). When the
// upload or the POST fails because the network is gone, the capture is parked
// here — audio blobs and text alike — and replayed on the next 'online' event
// or the next time the capture screen mounts.
//
// IndexedDB is the store because an audio blob has no business in
// localStorage. If IndexedDB is unavailable or over quota (private windows,
// a long recording), the queue falls back to memory for this tab and the
// caller warns that the capture only survives while the tab is open.

export interface QueuedCapture {
  id: string;
  source: string;
  text?: string;
  audio?: Blob;
  audioType?: string;
  createdAt: number;
}

export type QueueOutcome = "stored" | "memory";

const DB_NAME = "lifeos-captures";
const STORE = "pending";
const VERSION = 1;

/** Tab-lifetime fallback when IndexedDB will not take the item. */
const memoryQueue: QueuedCapture[] = [];

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
        transaction.oncomplete = () => db.close();
      }),
  );
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `q-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Park a capture. Returns where it landed so the caller can be honest. */
export async function queueCapture(
  item: Omit<QueuedCapture, "id" | "createdAt">,
): Promise<QueueOutcome> {
  const entry: QueuedCapture = { ...item, id: newId(), createdAt: Date.now() };
  try {
    await tx("readwrite", (store) => store.put(entry) as IDBRequest<IDBValidKey>);
    return "stored";
  } catch {
    // Quota, private mode, no IndexedDB: keep it for this tab at least.
    memoryQueue.push(entry);
    return "memory";
  }
}

export async function listQueued(): Promise<QueuedCapture[]> {
  let stored: QueuedCapture[] = [];
  try {
    stored = (await tx("readonly", (store) => store.getAll() as IDBRequest<QueuedCapture[]>)) ?? [];
  } catch {
    stored = [];
  }
  return [...stored, ...memoryQueue].sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeQueued(id: string): Promise<void> {
  const index = memoryQueue.findIndex((q) => q.id === id);
  if (index >= 0) memoryQueue.splice(index, 1);
  try {
    await tx("readwrite", (store) => store.delete(id) as IDBRequest<undefined>);
  } catch {
    // Nothing to remove, or the store is gone: the memory copy is already out.
  }
}

export async function countQueued(): Promise<number> {
  return (await listQueued()).length;
}

/**
 * One flusher at a time — across tabs, not just within one. Both the shell
 * (app-lifecycle) and the capture screen replay this queue, and two open tabs
 * share the same IndexedDB, so without a cross-tab lock both could list the
 * same items and send them twice. The Web Locks API (Safari 15.4+/Chrome 69+)
 * gives an origin-wide mutex; `ifAvailable` skips instead of queueing, since
 * whichever holder finishes will have drained the queue. The module flag
 * remains as the same-tab guard and the fallback where Web Locks is missing.
 * Returns null when another flush already holds the lock.
 */
let flushing = false;
export async function withFlushLock<T>(run: () => Promise<T>): Promise<T | null> {
  if (flushing) return null;
  flushing = true;
  try {
    if (typeof navigator !== "undefined" && "locks" in navigator) {
      return await navigator.locks.request(
        "lifeos-capture-flush",
        { ifAvailable: true },
        async (lock) => (lock ? await run() : null),
      );
    }
    return await run();
  } finally {
    flushing = false;
  }
}

/**
 * True when a failure looks like "there is no network" rather than "the server
 * said no": an offline browser, a fetch TypeError, or the message Supabase and
 * the browsers use when the request never left.
 */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true;
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /failed to fetch|networkerror|network request failed|load failed|err_internet/i.test(
    message,
  );
}
