"use client";

// Web Push opt-in (SPEC §8). iOS only delivers push to a PWA installed on the
// Home Screen, and only when permission is requested from a user tap — so this
// is a button, never an effect.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Phase = "checking" | "unsupported" | "needs_install" | "idle" | "subscribed" | "denied";

function deviceLabel(): string {
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

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function applicationServerKey(base64: string): ArrayBuffer {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export function EnablePush({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
        if (!cancelled) setPhase(sub ? "subscribed" : "idle");
      } catch {
        if (!cancelled) setPhase("idle");
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

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
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(vapidPublicKey),
        }));
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
      setPhase("subscribed");
      setMessage(`This device is registered as ${deviceLabel()}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }, [vapidPublicKey]);

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
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "The test push failed.");
    } finally {
      setBusy(false);
    }
  }, []);

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
          {busy ? "Enabling" : "Enable notifications"}
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

      {message ? <p className="text-[13px] text-ink-2">{message}</p> : null}
    </div>
  );
}
