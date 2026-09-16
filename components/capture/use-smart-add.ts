"use client";

// Smart add: hand a raw sentence to the capture pipeline instead of the
// deterministic token parser, so "make chicken katsu today, priority very
// high, before 12 noon" becomes one dated task, and three sentences become
// three tasks. This is POST /api/capture with source `desktop_text` — the same
// path the capture screen uses — not a second pipeline. Used by the tasks
// quick-add field and by the command palette.

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/tasks/toast";
import { isPhone, postCapture } from "@/components/capture/send";
import { waitForCaptureRow } from "@/components/capture/wait";
import type { CaptureResult } from "@/lib/types";

/** Typed captures are filed inline by the route, so this rarely loops twice. */
const POLL_MS = 1200;
const MAX_WAIT_MS = 30_000;

const NOUNS: Record<string, [one: string, many: string]> = {
  task: ["task", "tasks"],
  reminder: ["reminder", "reminders"],
  note: ["note", "notes"],
  routine_log: ["routine log", "routine logs"],
  person_update: ["person update", "person updates"],
};

/** "Added 2 tasks and 1 note" — counts by kind, in the order they were filed. */
export function summarizeCapture(result: CaptureResult | null): string {
  const counts = new Map<string, number>();
  for (const item of result?.items ?? []) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);

  const parts = Array.from(counts, ([type, n]) => {
    const [one, many] = NOUNS[type] ?? [type, `${type}s`];
    return `${n} ${n === 1 ? one : many}`;
  });
  if (!parts.length) return "Nothing to file from that";

  const list =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;
  return `Added ${list}`;
}

export function useSmartAdd() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [working, setWorking] = useState(false);
  const inFlight = useRef(false);

  /** Resolves false when the text could not be filed, so a caller can put it back. */
  const smartAdd = useCallback(
    async (input: string): Promise<boolean> => {
      const text = input.trim();
      if (!text || inFlight.current) return false;
      inFlight.current = true;
      setWorking(true);
      try {
        const source = isPhone() ? "phone_text" : "desktop_text";
        const captureId = await postCapture({ text, source });

        const row = await waitForCaptureRow(supabase, captureId, {
          pollMs: POLL_MS,
          maxWaitMs: MAX_WAIT_MS,
        });
        router.refresh();
        if (!row) {
          // Still filing after 30s: the job route finishes it either way.
          toast("Still filing. It finishes in the background.");
          return true;
        }
        if (row.status === "failed") {
          toast(row.error ?? "That could not be filed.");
          return false;
        }
        const summary = summarizeCapture(row.result);
        const clarification = row.result?.needs_clarification?.trim();
        toast(clarification ? `${summary}. ${clarification}` : summary);
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Adding failed. Try again.");
        return false;
      } finally {
        inFlight.current = false;
        setWorking(false);
      }
    },
    [router, supabase],
  );

  return { smartAdd, working };
}
