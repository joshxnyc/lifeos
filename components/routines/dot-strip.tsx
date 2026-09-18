import { cn } from "@/lib/utils";
import type { DotStatus } from "./format";

// DESIGN_BRIEF §5.5 / §6: 28-day strip. Done fills `ok`, skipped is a hollow
// ink-3 ring (the one sanctioned use of ink-3, §8), missed fills `danger`,
// unscheduled and future days stay faint.
const DOT_CLASS: Record<DotStatus, string> = {
  done: "bg-ok",
  skipped: "border border-ink-3 bg-transparent",
  missed: "bg-danger",
  pending: "border border-ink-3 bg-transparent",
  off: "border border-line bg-transparent",
};

export function DotStrip({
  days,
  className,
  columns = 14,
}: {
  days: { date: string; status: DotStatus }[];
  className?: string;
  /** Canvas 1h lays 28 days out as two rows of 14. */
  columns?: number;
}) {
  return (
    <div
      className={cn("grid w-full gap-[3px]", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      role="img"
      aria-label={`${days.filter((d) => d.status === "done").length} done in the last ${days.length} days`}
    >
      {days.map((d) => (
        <span
          key={d.date}
          className={cn("aspect-square rounded-full", DOT_CLASS[d.status])}
        />
      ))}
    </div>
  );
}
