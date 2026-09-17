"use client";

// Shell-level lifecycle chores, mounted once in the app layout:
//
// 1. Replay offline captures from anywhere. The IndexedDB queue used to be
//    flushed only by the capture screen, so a voice note parked by the global
//    record sheet ("Saved offline") sat unsent until Joshua happened to visit
//    /capture. The capture screen keeps its own flusher (with inline notes),
//    so this one stands down there.
// 2. Refresh on resume. iOS keeps a standalone PWA's DOM alive for days;
//    without this, opening the app in the morning shows yesterday's Today
//    until a navigation happens.

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/tasks/toast";
import { postCapture, uploadAudio } from "@/components/capture/send";
import { isNetworkError, listQueued, removeQueued } from "@/components/capture/offline-queue";

const STALE_AFTER_MS = 60_000;

export function AppLifecycle() {
  const router = useRouter();
  const pathname = usePathname();
  const hiddenAtRef = useRef<number | null>(null);
  const flushingRef = useRef(false);
  const onCaptureScreen = pathname === "/capture" || pathname.startsWith("/capture/");

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    flushingRef.current = true;
    try {
      const items = await listQueued();
      if (!items.length) return;
      const supabase = createClient();
      let sent = 0;
      for (const item of items) {
        try {
          if (item.audio) {
            const path = await uploadAudio(supabase, item.audio);
            await postCapture({ audioPath: path, source: item.source });
          } else if (item.text) {
            await postCapture({ text: item.text, source: item.source });
          }
          await removeQueued(item.id);
          sent += 1;
        } catch (err) {
          if (isNetworkError(err)) break; // still offline: leave the rest queued
          // Rejected on its merits: drop it rather than retry forever.
          await removeQueued(item.id);
          toast(err instanceof Error ? `An offline capture was rejected: ${err.message}` : "An offline capture was rejected.");
        }
      }
      if (sent) {
        toast(`${sent} offline ${sent === 1 ? "capture" : "captures"} sent.`);
        router.refresh();
      }
    } finally {
      flushingRef.current = false;
    }
  }, [router]);

  useEffect(() => {
    if (onCaptureScreen) return; // the capture screen runs its own flusher
    void flush();
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flush, onCaptureScreen]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      const dayChanged =
        hiddenAt !== null && new Date(hiddenAt).toDateString() !== new Date().toDateString();
      if (hiddenAt !== null && (Date.now() - hiddenAt > STALE_AFTER_MS || dayChanged)) {
        router.refresh();
        if (!onCaptureScreen) void flush();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router, flush, onCaptureScreen]);

  return null;
}
