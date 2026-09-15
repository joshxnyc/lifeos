"use client";

// Routine pills on Today: tap marks done, long-press skips (DESIGN_BRIEF §5.1).
// The write goes through A3's logRoutine via a thin server action.

import { useRef, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { logRoutineToday } from "@/app/(app)/today/actions";
import { toast } from "@/components/tasks/toast";
import type { RoutineLogStatus } from "@/lib/types";

export interface RoutinePillData {
  id: string;
  name: string;
  streak: number;
  status: RoutineLogStatus | null;
  /** Past its reminder time but still inside the grace window. */
  inGrace: boolean;
}

const LONG_PRESS_MS = 500;

export function RoutinesRow({ routines, date }: { routines: RoutinePillData[]; date: string }) {
  if (routines.length === 0) return null;
  return (
    <section className="mb-7">
      <p className="section-label mb-1.5">Routines</p>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {routines.map((r) => (
          <RoutinePill key={r.id} routine={r} date={date} />
        ))}
      </div>
    </section>
  );
}

function RoutinePill({ routine, date }: { routine: RoutinePillData; date: string }) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<RoutineLogStatus | null>(routine.status);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);

  function log(status: "done" | "skipped") {
    setOptimistic(status);
    startTransition(async () => {
      const res = await logRoutineToday(routine.id, date, status);
      if (!res.ok) {
        setOptimistic(routine.status);
        toast(res.error);
      } else {
        toast(status === "done" ? `${routine.name} done` : `${routine.name} skipped today`);
      }
    });
  }

  function onPointerDown() {
    longPressed.current = false;
    timer.current = setTimeout(() => {
      longPressed.current = true;
      log("skipped");
    }, LONG_PRESS_MS);
  }

  function onPointerUp() {
    clearTimeout(timer.current);
  }

  function onClick() {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (optimistic === "done") return;
    log("done");
  }

  const done = optimistic === "done";
  const skipped = optimistic === "skipped";
  const missed = optimistic === "missed";

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={`${routine.name}${done ? ", done" : ""}. Tap to mark done, hold to skip.`}
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[14px] select-none",
        done && "border-ok bg-ok/10 text-ink",
        skipped && "border-line text-ink-3",
        missed && "border-danger text-danger",
        !done && !skipped && !missed && routine.inGrace && "border-warn text-ink",
        !done && !skipped && !missed && !routine.inGrace && "border-line text-ink",
      )}
    >
      {done ? <Check size={14} strokeWidth={3} className="text-ok" /> : null}
      <span className="max-w-[140px] truncate">{routine.name}</span>
      {routine.streak > 0 ? (
        <span className="tabular font-display text-[15px] text-ink-2">{routine.streak}</span>
      ) : null}
    </button>
  );
}
