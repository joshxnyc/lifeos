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

// Canvas 1p: a heavy day takes the full accent-soft tint, a middling one a
// half-strength wash, a light day none at all.
function heat(hours: number): string {
  if (hours >= 6) return "bg-accent-soft";
  if (hours >= 3) return "bg-accent-soft/50";
  return "";
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
      <p className="display-lead mt-2 leading-[1.3]">
        {totalDue} due, {totalHours} hours of meetings.
      </p>

      {/* One row per day on the phone; seven columns from md up. */}
      <div className="mt-5 flex flex-col gap-0.5 md:grid md:grid-cols-7 md:gap-2">
        {days.map((day) => (
          <div
            key={day.date}
            className={cn(
              "grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-[8px] p-2.5 md:block md:rounded-card md:border md:border-line",
              heat(day.hours),
            )}
          >
            <span className="text-[15px] font-medium">{day.label}</span>
            <span
              className={cn(
                "truncate text-[14px] md:mt-1.5 md:block md:whitespace-normal",
                day.tasks.length ? "text-ink" : "text-ink-2",
              )}
            >
              {day.tasks.length
                ? day.tasks.map((t) => t.title).join(" · ")
                : "Nothing due"}
            </span>
            <span
              className={cn(
                "tabular text-[13px] md:mt-1 md:block",
                day.hours >= 6 ? "font-medium text-accent" : "text-ink-2",
              )}
            >
              {day.hours}h
            </span>
          </div>
        ))}
      </div>

      <section className="mt-7">
        <h2 className="section-label mb-2.5">Top 3 for the week</h2>
        {/* Canvas 1p: three numbered slots; an empty one is a dashed row that
            says what to do, not a placeholder label. */}
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((slot) => {
            const pick = picks[slot];
            return (
              <div
                key={slot}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-card border p-3",
                  pick ? "border-line" : "border-dashed border-ink-3 text-ink-2",
                )}
              >
                <span className="w-4 shrink-0 font-display text-[20px] text-ink-2">{slot + 1}</span>
                {pick ? (
                  <button
                    className="min-w-0 flex-1 truncate text-left text-[15px] text-ink"
                    onClick={() => toggle(pick)}
                  >
                    {pick.title}
                  </button>
                ) : (
                  <span className="flex-1 text-[15px]">Pick one from the list below</span>
                )}
              </div>
            );
          })}
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
