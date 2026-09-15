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
  return (
    <nav aria-label="Review steps" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-4">
      {REVIEW_STEPS.map((label, index) => {
        const n = index + 1;
        const current = n === step;
        const available = n <= reached;
        const content = (
          <span
            className={cn(
              "text-[11px] uppercase tracking-[0.08em]",
              current ? "text-accent" : available ? "text-ink-2" : "text-ink-3",
            )}
          >
            {n} {label}
          </span>
        );
        return (
          <span key={label} className="flex items-center gap-3">
            {available && !current ? (
              <Link href={`/review/${weekStart}/${n}`} className="flex min-h-11 items-center">
                {content}
              </Link>
            ) : (
              <span className="flex min-h-11 items-center">{content}</span>
            )}
            {n < REVIEW_STEPS.length ? <span className="text-ink-3">·</span> : null}
          </span>
        );
      })}
    </nav>
  );
}
