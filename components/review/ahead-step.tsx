"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { goToStep, saveTop3 } from "@/app/(app)/review/actions";

// DESIGN_BRIEF §5.9 step 4 — next week by day with a heat tint by hours
// booked, then the three slots for the week's top three.

export interface AheadDay {
  date: string;
  label: string; // "Mon 22"
  hours: number;
  tasks: { id: string; title: string }[];
}

export interface Candidate {
  type: "task" | "suggestion";
  id: string;
  title: string;
  meta: string | null;
}

function heat(hours: number): string {
  if (hours >= 6) return "bg-accent-soft";
  if (hours >= 3) return "bg-paper-2";
  return "bg-paper";
}

export function AheadStep({
  weekStart,
  days,
  candidates,
  initial,
}: {
  weekStart: string;
  days: AheadDay[];
  candidates: Candidate[];
  initial: string[];
}) {
  const [picks, setPicks] = useState<Candidate[]>(
    candidates.filter((c) => c.type === "task" && initial.includes(c.id)).slice(0, 3),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(candidate: Candidate) {
    setPicks((prev) => {
      const exists = prev.find((p) => p.id === candidate.id);
      if (exists) return prev.filter((p) => p.id !== candidate.id);
      if (prev.length >= 3) return prev;
      return [...prev, candidate];
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await saveTop3(
          weekStart,
          picks.map((p) => ({ type: p.type, id: p.id })),
        );
        await goToStep(weekStart, 5);
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) throw err;
        setError(err instanceof Error ? err.message : "That didn't save.");
      }
    });
  }

  const totalHours = Math.round(days.reduce((sum, d) => sum + d.hours, 0) * 10) / 10;
  const totalDue = days.reduce((sum, d) => sum + d.tasks.length, 0);

  return (
    <div className="py-4">
      <p className="text-[15px] text-ink-2">
        Next week: {totalDue} due, {totalHours}h booked.
      </p>

      <div className="mt-4 grid gap-2 md:grid-cols-7">
        {days.map((day) => (
          <div key={day.date} className={cn("rounded-card border border-line p-2", heat(day.hours))}>
            <p className="section-label">{day.label}</p>
            <p className="mt-0.5 text-[12px] text-ink-2 tabular">
              {day.hours ? `${day.hours}h booked` : "no meetings"}
            </p>
            <ul className="mt-1.5 space-y-1">
              {day.tasks.slice(0, 4).map((t) => (
                <li key={t.id} className="truncate text-[13px] text-ink">
                  {t.title}
                </li>
              ))}
              {day.tasks.length > 4 ? (
                <li className="text-[12px] text-ink-2">+{day.tasks.length - 4} more</li>
              ) : null}
              {!day.tasks.length ? <li className="text-[13px] text-ink-3">—</li> : null}
            </ul>
          </div>
        ))}
      </div>

      <section className="mt-7">
        <h2 className="section-label mb-2">Top 3 for the week</h2>
        <div className="grid gap-2 md:grid-cols-3">
          {[0, 1, 2].map((slot) => (
            <div
              key={slot}
              className="flex min-h-[64px] items-center rounded-card border border-dashed border-line p-3 text-[14px]"
            >
              {picks[slot] ? (
                <button className="text-left text-ink" onClick={() => toggle(picks[slot]!)}>
                  {picks[slot]!.title}
                  <span className="mt-0.5 block text-[12px] text-ink-2">Tap to remove</span>
                </button>
              ) : (
                <span className="text-ink-3">Slot {slot + 1}</span>
              )}
            </div>
          ))}
        </div>

        <ul className="mt-4 border-t border-line">
          {candidates.map((candidate) => {
            const chosen = picks.some((p) => p.id === candidate.id);
            return (
              <li key={`${candidate.type}-${candidate.id}`} className="border-b border-line">
                <button
                  onClick={() => toggle(candidate)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] text-ink">{candidate.title}</span>
                    {candidate.meta ? (
                      <span className="block truncate text-[12px] text-ink-2">{candidate.meta}</span>
                    ) : null}
                  </span>
                  <span className={cn("shrink-0 text-[13px]", chosen ? "text-accent" : "text-ink-2")}>
                    {chosen ? "Picked" : "Pick"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {!candidates.length ? <p className="py-6 text-[14px] text-ink-2">Nothing open to pick from.</p> : null}
      </section>

      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}

      <div className="mt-6">
        <Button variant="primary" disabled={pending} onClick={save}>
          Continue
        </Button>
      </div>
    </div>
  );
}
