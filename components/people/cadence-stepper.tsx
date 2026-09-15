"use client";

import { useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { setFollowUpCadenceAction } from "@/app/(app)/people/actions";

// "Every 14 days" stepper (DESIGN_BRIEF §5.6). Steps move through the useful
// cadences rather than one day at a time.
const STEPS = [7, 14, 21, 30, 60, 90, 180];

export function CadenceStepper({ personId, days }: { personId: string; days: number | null }) {
  const [value, setValue] = useState<number | null>(days);
  const [pending, startTransition] = useTransition();

  function save(next: number | null) {
    setValue(next);
    startTransition(async () => {
      await setFollowUpCadenceAction(personId, next);
    });
  }

  function step(direction: -1 | 1) {
    if (value === null) {
      save(direction === 1 ? 14 : null);
      return;
    }
    const index = STEPS.findIndex((s) => s >= value);
    const current = index === -1 ? STEPS.length - 1 : index;
    const next = current + direction;
    if (next < 0) save(null);
    else save(STEPS[Math.min(next, STEPS.length - 1)]!);
  }

  return (
    // Canvas 1k: one hairline pill split into − / value / + by internal rules.
    <div className="inline-flex items-center overflow-hidden rounded-full border border-line">
      <button
        type="button"
        aria-label="Less often"
        onClick={() => step(-1)}
        disabled={pending}
        className="flex h-11 w-10 items-center justify-center border-r border-line text-ink-2"
      >
        <Minus size={16} />
      </button>
      <span className="tabular px-3 text-center text-[13px] text-ink">
        {value ? `Every ${value} days` : "No cadence"}
      </span>
      <button
        type="button"
        aria-label="More often"
        onClick={() => step(1)}
        disabled={pending}
        className="flex h-11 w-10 items-center justify-center border-l border-line text-ink-2"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
