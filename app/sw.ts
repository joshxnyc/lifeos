import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";
import {
  deviceLabel,
  readVapidPublicKey,
  toApplicationServerKey,
} from "../components/push/vapid";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & WorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Authenticated data must never persist in CacheStorage: /api holds the
    // export zip, capture transcripts and settings payloads. Offline support
    // (SPEC §11) is the app shell + the last rendered pages, not API data.
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();

// Web Push: show the notification and deep-link on tap (SPEC §8). task_due
// payloads carry action buttons ("Done", "Snooze 1h"); TypeScript's lib types
// don't know `actions` on NotificationOptions, but every SW notification is
// persistent, so passing it is valid — platforms without buttons ignore it and
// a body tap still opens the URL.
interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  actions?: { action: string; title: string }[];
  task_id?: string;
}

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload: PushPayload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }
  const options: NotificationOptions & { actions?: { action: string; title: string }[] } = {
    body: payload.body ?? "",
    tag: payload.tag,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: payload.url ?? "/today", task_id: payload.task_id },
  };
  if (payload.actions?.length && payload.task_id) options.actions = payload.actions;
  event.waitUntil(self.registration.showNotification(payload.title ?? "LifeOS", options));
});

// Push services rotate subscriptions (key expiry, service maintenance). When
// that happens with no page open, only the SW can re-subscribe — otherwise
// push dies silently until the next visit. The VAPID public key comes from,
// in order: the old subscription itself, the IndexedDB copy the page stores at
// enable time, or GET /api/push/vapid-key. The subscribe POST rides on the
// same-origin session cookies (credentials: "include"); signed out, the server
// answers 401/redirect and no row is created, which is the correct outcome.
interface PushSubscriptionChangeEvent extends ExtendableEvent {
  readonly oldSubscription?: PushSubscription | null;
  readonly newSubscription?: PushSubscription | null;
}

self.addEventListener("pushsubscriptionchange", ((event: PushSubscriptionChangeEvent) => {
  event.waitUntil(resubscribe(event));
}) as EventListener);

async function resubscribe(event: PushSubscriptionChangeEvent): Promise<void> {
  try {
    // Some browsers hand over the replacement subscription; use it as-is.
    let sub = event.newSubscription ?? null;
    if (!sub) {
      const key =
        event.oldSubscription?.options?.applicationServerKey ?? (await findServerKey());
      if (!key) return; // no key, no valid re-subscribe — the Settings panel shows the dead row
      sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    }

    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
    if (!json.endpoint || !json.keys) return;
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, deviceLabel: deviceLabel() }),
    });

    // The replaced endpoint is dead; drop its row instead of waiting for 410s.
    const old = event.oldSubscription?.endpoint;
    if (res.ok && old && old !== json.endpoint) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: old }),
      });
    }
  } catch {
    // Send-time 410 cleanup and the Settings device list surface the loss.
  }
}

async function findServerKey(): Promise<ArrayBuffer | null> {
  const stored = await readVapidPublicKey();
  if (stored) return toApplicationServerKey(stored);
  try {
    const res = await fetch("/api/push/vapid-key", { credentials: "include" });
    if (!res.ok) return null;
    const { key } = (await res.json()) as { key?: string };
    return key ? toApplicationServerKey(key) : null;
  } catch {
    return null;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { url?: string; task_id?: string };
  const url = data.url ?? "/today";

  // Action buttons act without opening the app; a body tap (empty action, and
  // the only path on platforms without buttons) opens the notification's URL.
  if ((event.action === "complete" || event.action === "snooze") && data.task_id) {
    event.waitUntil(actOnTask(event.action, data.task_id, url));
    return;
  }
  event.waitUntil(openApp(url));
});

/**
 * POST the action to the app; session cookies ride along. On any failure
 * (offline, signed out, server error) be honest: a fallback notification says
 * it didn't happen and links to the task.
 */
async function actOnTask(action: "complete" | "snooze", taskId: string, url: string): Promise<void> {
  try {
    const res = await fetch("/api/push/act", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, task_id: taskId }),
    });
    if (!res.ok) throw new Error(`act ${res.status}`);
  } catch {
    await self.registration.showNotification("LifeOS", {
      body: "Couldn't reach LifeOS — open the app.",
      tag: `push-act-failed-${taskId}`,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    });
  }
}

async function openApp(url: string): Promise<void> {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    if ("focus" in client) {
      await client.focus();
      if ("navigate" in client) await client.navigate(url);
      return;
    }
  }
  await self.clients.openWindow(url);
}
