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
        "relative flex min-h-[140px] select-none flex-col justify-between overflow-hidden rounded-card border border-l-[3px] border-line bg-paper p-3 text-left transition-[transform,background-color] duration-150 disabled:opacity-60",
        todayStatus === "done" && "bg-accent-soft/40",
        ticking && "scale-[0.98]",
      )}
      style={domainColor ? { borderLeftColor: domainColor } : undefined}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-[15px] font-medium leading-snug text-ink">
          {emoji ? <span className="mr-1.5">{emoji}</span> : null}
          {name}
        </span>
        {todayStatus === "done" ? (
          <Check className="size-[18px] shrink-0 text-ok" aria-hidden />
        ) : todayStatus === "skipped" ? (
          <Minus className="size-[18px] shrink-0 text-ink-2" aria-hidden />
        ) : null}
      </span>

      <StreakNumber value={streak} />

      <span className="flex flex-col gap-1.5">
        <DotStrip days={days} />
        <span className="tabular text-[11px] text-ink-2">
          {Math.round(rate * 100)}% · 28 days
          {todayStatus === "skipped" ? " · skipped today" : ""}
        </span>
        {error ? <span className="text-[11px] text-danger">{error}</span> : null}
      </span>
    </button>
  );
}
