"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { toggleRoutineActive } from "@/lib/routines";

export function ActiveToggle({
  routineId,
  active,
  name,
}: {
  routineId: string;
  active: boolean;
  name: string;
}) {
  const [on, setOn] = useState(active);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${name} active`}
      disabled={pending}
      onClick={() => {
        const next = !on;
        setOn(next);
        startTransition(async () => {
          try {
            await toggleRoutineActive(routineId, next);
          } catch {
            setOn(!next);
          }
        });
      }}
      className="flex size-11 shrink-0 items-center justify-center disabled:opacity-60"
    >
      <span
        className={cn(
          "relative block h-6 w-11 rounded-full border transition-colors",
          on ? "border-accent bg-accent" : "border-line bg-paper-2",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] size-[18px] rounded-full bg-paper transition-[left] duration-150",
            on ? "left-[24px]" : "left-[2px]",
          )}
        />
      </span>
    </button>
  );
}
