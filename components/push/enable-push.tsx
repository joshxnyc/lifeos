"use client";

// Web Push opt-in (SPEC §8). iOS only delivers push to a PWA installed on the
// Home Screen, and only when permission is requested from a user tap — so this
// is a button, never an effect.
//
// The device list below the button is the SERVER's view (push_subscriptions
// rows): lib/push.ts deletes a row after repeated 410s, so a device can hold a
// browser-side subscription that no longer receives anything. "Subscribed"
// here means this device's endpoint has a healthy row, not merely that
// getSubscription() returned something.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  deviceLabel,
  storeVapidPublicKey,
  toApplicationServerKey,
} from "@/components/push/vapid";

type Phase = "checking" | "unsupported" | "needs_install" | "idle" | "subscribed" | "denied";

export interface PushDevice {
  id: string;
  endpoint: string;
  device_label: string | null;
  last_used_at: string | null;
  failed_count: number;
}

/**
 * `serviceWorker.ready` never settles when no worker is registered — which is
 * the case in dev, where next.config disables Serwist. Time out instead of
 * leaving the section stuck on "Checking".
 */
async function readyRegistration(ms = 4000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function EnablePush({
  vapidPublicKey,
  devices,
}: {
  vapidPublicKey: string;
  devices: PushDevice[];
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [browserEndpoint, setBrowserEndpoint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setPhase(isIos() && !isStandalone() ? "needs_install" : "unsupported");
        return;
      }
      if (isIos() && !isStandalone()) {
        if (!cancelled) setPhase("needs_install");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setPhase("denied");
        return;
      }
      try {
        const reg = await readyRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        // Installs subscribed before the SW could self-heal: make sure the key
        // is in IndexedDB for pushsubscriptionchange (sw.ts).
        if (sub) void storeVapidPublicKey(vapidPublicKey);
        if (cancelled) return;
        setBrowserEndpoint(sub?.endpoint ?? null);
        const row = sub ? devices.find((d) => d.endpoint === sub.endpoint) : undefined;
        setPhase(row && row.failed_count === 0 ? "subscribed" : "idle");
      } catch {
        if (!cancelled) setPhase("idle");
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [devices, vapidPublicKey]);

  const enable = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (!vapidPublicKey) throw new Error("VAPID_PUBLIC_KEY is not set on the server.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPhase(permission === "denied" ? "denied" : "idle");
        setMessage("Permission was not granted.");
        return;
      }
      const reg = await readyRegistration();
      if (!reg) throw new Error("The service worker is not registered yet. Reload and try again.");

      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        const row = devices.find((d) => d.endpoint === endpoint);
        // A subscription the server lost, or one that stopped accepting
        // deliveries, is dead weight: mint a fresh endpoint rather than
        // re-registering the stale one.
        if (!row || row.failed_count > 0) {
          await sub.unsubscribe().catch(() => {});
          sub = null;
        }
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toApplicationServerKey(vapidPublicKey),
        });
      }
      // The SW needs the key to re-subscribe on pushsubscriptionchange.
      await storeVapidPublicKey(vapidPublicKey);

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          deviceLabel: deviceLabel(),
        }),
      });
      if (!res.ok) throw new Error("The server rejected this subscription.");
      setBrowserEndpoint(json.endpoint ?? null);
      setPhase("subscribed");
      setMessage(`This device is registered as ${deviceLabel()}.`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }, [vapidPublicKey, devices, router]);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = (await res.json()) as { delivered?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "The test push failed.");
      setMessage(
        data.delivered
          ? `Sent to ${data.delivered} ${data.delivered === 1 ? "device" : "devices"}.`
          : "No registered device accepted the push.",
      );
      // last_used_at / failed_count moved: refresh the server-rendered roster.
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "The test push failed.");
    } finally {
      setBusy(false);
    }
  }, [router]);

  const thisRow = browserEndpoint ? devices.find((d) => d.endpoint === browserEndpoint) : undefined;

  return (
    <div className="flex flex-col items-start gap-2">
      {phase === "checking" ? <p className="text-[13px] text-ink-2">Checking this device.</p> : null}

      {phase === "needs_install" ? (
        <p className="text-[13px] text-ink-2">
          Install to Home Screen first. Share → Add to Home Screen, then open LifeOS from the icon
          and come back here.
        </p>
      ) : null}

      {phase === "unsupported" ? (
        <p className="text-[13px] text-ink-2">This browser cannot receive push notifications.</p>
      ) : null}

      {phase === "denied" ? (
        <p className="text-[13px] text-ink-2">
          Notifications are blocked for this site. Allow them in the browser or system settings,
          then reload.
        </p>
      ) : null}

      {phase === "idle" ? (
        <Button variant="primary" onClick={enable} disabled={busy}>
          {busy ? "Enabling" : thisRow ? "Re-enable notifications" : "Enable notifications"}
        </Button>
      ) : null}

      {phase === "subscribed" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ok">Notifications are on for this device.</span>
          <Button variant="secondary" onClick={sendTest} disabled={busy}>
            {busy ? "Sending" : "Send test"}
          </Button>
        </div>
      ) : null}

      {/* The server's device roster. Rendered after the client check so the
          "this device" marker never mismatches during hydration. */}
      {phase !== "checking" && devices.length ? (
        <ul className="mt-1 flex w-full flex-col gap-1.5">
          {devices.map((d) => {
            const failing = d.failed_count > 0;
            const isThis = browserEndpoint !== null && d.endpoint === browserEndpoint;
            return (
              <li key={d.id} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="text-ink">{d.device_label ?? "Unnamed device"}</span>
                {isThis ? <span className="text-ink-3">this device</span> : null}
                <span className={failing ? "text-danger" : "text-ink-2"}>
                  {failing
                    ? `not receiving push — ${d.failed_count} failed ${
                        d.failed_count === 1 ? "delivery" : "deliveries"
                      }`
                    : d.last_used_at
                      ? `last push ${formatDay(d.last_used_at)}`
                      : "no push delivered yet"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {message ? <p className="text-[13px] text-ink-2">{message}</p> : null}
    </div>
  );
}
