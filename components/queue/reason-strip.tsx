"use client";

// The optional second life of a dismiss. Dismissing stays one gesture; this
// strip then floats above the tab bar for ~6 seconds offering four one-tap
// reasons, which PATCH `dismissed_reason` onto the just-dismissed row. Not
// answering is fine — the row keeps null and nothing nags.
//
// The toast carries the "Dismissed" line and its single Undo action, so this
// is its own transient component, event-wired like the toast: the host is
// mounted once by the queue page (which survives the card's unmount on
// refresh), and any card can call `showReasonStrip(id)`.
import { useEffect, useRef, useState } from "react";
import { setDismissalReason } from "@/app/(app)/queue/actions";
import { toast } from "@/components/tasks/toast";
import type { DismissedReason } from "@/lib/types";

const SHOW_EVENT = "lifeos:dismiss-reason-show";
const HIDE_EVENT = "lifeos:dismiss-reason-hide";
const LINGER_MS = 6000;

const CHIPS: { reason: DismissedReason; label: string }[] = [
  { reason: "not_a_task", label: "Not a task" },
  { reason: "already_done", label: "Done already" },
  { reason: "not_mine", label: "Not mine" },
  { reason: "wrong_details", label: "Wrong details" },
];

/** Show the strip for this just-dismissed suggestion. */
export function showReasonStrip(suggestionId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(SHOW_EVENT, { detail: suggestionId }));
}

/** Hide the strip if it is showing this suggestion (e.g. Undo was pressed). */
export function hideReasonStrip(suggestionId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(HIDE_EVENT, { detail: suggestionId }));
}

export function ReasonStripHost() {
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const onShow = (e: Event) => {
      setSuggestionId((e as CustomEvent<string>).detail);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setSuggestionId(null), LINGER_MS);
    };
    const onHide = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setSuggestionId((current) => (current === id ? null : current));
    };
    window.addEventListener(SHOW_EVENT, onShow);
    window.addEventListener(HIDE_EVENT, onHide);
    return () => {
      window.removeEventListener(SHOW_EVENT, onShow);
      window.removeEventListener(HIDE_EVENT, onHide);
      clearTimeout(timerRef.current);
    };
  }, []);

  if (!suggestionId) return null;

  function pick(reason: DismissedReason) {
    const id = suggestionId;
    clearTimeout(timerRef.current);
    setSuggestionId(null);
    if (!id) return;
    // Fire and settle quietly: a late tap after an Undo updates nothing
    // server-side (the action only touches rows still at 'dismissed').
    void setDismissalReason(id, reason)
      .then((result) => {
        if (!result.ok) toast(result.error);
      })
      .catch(() => toast("That didn't save."));
  }

  return (
    <div
      role="group"
      aria-label="Why was this dismissed"
      className="pointer-events-none fixed inset-x-0 bottom-36 z-[60] flex justify-center px-4 md:bottom-[4.75rem]"
    >
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 rounded-card border border-line bg-paper px-3 py-2 shadow-whisper supports-[backdrop-filter]:bg-paper/90 supports-[backdrop-filter]:backdrop-blur-xl">
        <span className="px-1 text-[13px] text-ink-2">Why?</span>
        {CHIPS.map((chip) => (
          <button
            key={chip.reason}
            type="button"
            onClick={() => pick(chip.reason)}
            className="h-9 shrink-0 rounded-full bg-paper-2 px-3 text-[13px] text-ink"
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
