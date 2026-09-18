"use client";

// RoutineTile (DESIGN_BRIEF §5.5 / §6). Tap marks done with a 150ms tick,
// long-press skips today, and tapping an already-logged tile undoes it.
// Everything is one thumb-sized target; no menus.

import { useCallback, useRef, useState, useTransition } from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { logRoutine, undoRoutineLog } from "@/lib/routines";
import { DotStrip } from "./dot-strip";
import { StreakNumber } from "./streak-number";
import type { DotStatus } from "./format";

const LONG_PRESS_MS = 500;

export function RoutineTile({
  id,
  name,
  emoji,
  domainColor,
  today,
  todayStatus,
  streak,
  rate,
  days,
}: {
  id: string;
  name: string;
  emoji: string | null;
  domainColor: string | null;
  today: string;
  todayStatus: "done" | "skipped" | "missed" | null;
  streak: number;
  rate: number;
  days: { date: string; status: DotStatus }[];
}) {
  const [pending, startTransition] = useTransition();
  const [ticking, setTicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const longPressed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logged = todayStatus === "done" || todayStatus === "skipped";

  const run = useCallback(
    (fn: () => Promise<void>) => {
      setError(null);
      startTransition(async () => {
        try {
          await fn();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not save that.");
        }
      });
    },
    [startTransition],
  );

  const markDone = () => {
    setTicking(true);
    setTimeout(() => setTicking(false), 150);
    run(() => logRoutine(id, today, "done"));
  };

  const skip = () => {
    run(() => logRoutine(id, today, "skipped"));
  };

  const undo = () => {
    run(() => undoRoutineLog(id, today));
  };

  const onPointerDown = () => {
    longPressed.current = false;
    timer.current = setTimeout(() => {
      longPressed.current = true;
      if (navigator.vibrate) navigator.vibrate(8);
      if (todayStatus === "skipped") undo();
      else skip();
    }, LONG_PRESS_MS);
  };

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const onClick = () => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (logged) undo();
    else markDone();
  };

  return (
    <button
      type="button"
      disabled={pending}
      onPointerDown={onPointerDown}
      onPointerUp={clearTimer}
      onPointerLeave={clearTimer}
      onPointerCancel={clearTimer}
      onContextMenu={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={
        logged
          ? `${name}, logged ${todayStatus} today. Tap to undo.`
          : `${name}. Tap to mark done, press and hold to skip today.`
      }
      className={cn(
        // Canvas 1h: a 118px tile whose single hairline border carries the
        // status — ok when logged, line otherwise. The domain shows as a dot
        // beside the name, never as a fill.
        "relative flex min-h-[118px] select-none flex-col justify-between overflow-hidden rounded-card border bg-paper p-3.5 text-left transition-[transform,border-color] duration-150 disabled:opacity-60",
        todayStatus === "done" ? "border-ok" : "border-line",
        ticking && "scale-[0.98]",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[15px] leading-snug font-medium text-ink">
          {domainColor ? (
            <span
              aria-hidden
              className="size-[7px] shrink-0 rounded-full"
              style={{ backgroundColor: domainColor }}
            />
          ) : null}
          <span className="min-w-0">
            {emoji ? <span className="mr-1.5">{emoji}</span> : null}
            {name}
          </span>
        </span>
        {/* The 20px status ring: filled ok with a tick when done. */}
        <span
          aria-hidden
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full",
            todayStatus === "done"
              ? "bg-ok text-paper"
              : "border-[1.5px] border-ink-3 text-ink-2",
          )}
        >
          {todayStatus === "done" ? <Check className="size-3" strokeWidth={3.5} /> : null}
          {todayStatus === "skipped" ? <Minus className="size-3" strokeWidth={3} /> : null}
        </span>
      </span>

      <span className="flex flex-col gap-2.5">
        <StreakNumber value={streak} tone={todayStatus === "done" ? "ok" : "ink"} />
        <DotStrip days={days} />
        <span className="sr-only">{Math.round(rate * 100)}% over 28 days</span>
        {error ? <span className="text-[11px] text-danger">{error}</span> : null}
      </span>
    </button>
  );
}
