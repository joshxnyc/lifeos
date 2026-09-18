import Link from "next/link";
import { cn } from "@/lib/utils";

// DESIGN_BRIEF §5.9 — 1 Scorecard · 2 Slipped · 3 Dormant · 4 Ahead · 5 Coach.
// Steps already reached stay navigable; steps ahead do not.
export const REVIEW_STEPS = ["Scorecard", "Slipped", "Dormant", "Ahead", "Coach"] as const;

export function StepIndicator({
  weekStart,
  step,
  reached,
}: {
  weekStart: string;
  step: number;
  reached: number;
}) {
  // Canvas 1m–1q: five 3px bars filled up to the current step, with the step
  // names underneath and only the current one numbered and in ink.
  return (
    <nav aria-label="Review steps" className="mt-4.5">
      <div className="flex gap-1.5" aria-hidden>
        {REVIEW_STEPS.map((label, index) => (
          <span
            key={label}
            className={cn(
              "h-[3px] flex-1 rounded-[2px]",
              index + 1 <= step ? "bg-ink" : "bg-line",
            )}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between gap-2">
        {REVIEW_STEPS.map((label, index) => {
          const n = index + 1;
          const current = n === step;
          const available = n <= reached;
          const content = (
            <span
              className={cn(
                "text-[11px] tracking-[0.06em] uppercase",
                current ? "font-semibold text-ink" : "text-ink-2",
              )}
            >
              {current ? `${n} ${label}` : label}
            </span>
          );
          return available && !current ? (
            <Link
              key={label}
              href={`/review/${weekStart}/${n}`}
              className="flex min-h-11 items-center"
              aria-current={undefined}
            >
              {content}
            </Link>
          ) : (
            <span
              key={label}
              className={cn("flex min-h-11 items-center", !available && "opacity-60")}
              aria-current={current ? "step" : undefined}
            >
              {content}
            </span>
          );
        })}
      </div>
    </nav>
  );
}
