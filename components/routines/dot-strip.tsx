import { cn } from "@/lib/utils";
import type { DotStatus } from "./format";

// DESIGN_BRIEF §5.5 / §6: 28-day strip. Done fills `ok`, skipped is a hollow
// ink-3 ring (the one sanctioned use of ink-3, §8), missed fills `danger`,
// unscheduled and future days stay faint.
const DOT_CLASS: Record<DotStatus, string> = {
  done: "bg-ok",
  skipped: "border border-ink-3 bg-transparent",
  missed: "bg-danger",
  pending: "border border-ink-2/50 bg-transparent",
  off: "bg-line",
};

export function DotStrip({
  days,
  className,
  size = 4,
}: {
  days: { date: string; status: DotStatus }[];
  className?: string;
  size?: number;
}) {
  // 28 dots have to fit a 145px-wide tile at 390px, so they stay small; the
  // detail screen passes a larger size.
  return (
    <div
      className={cn("flex items-center gap-[1px] overflow-hidden", className)}
      role="img"
      aria-label={`${days.filter((d) => d.status === "done").length} done in the last ${days.length} days`}
    >
      {days.map((d) => (
        <span
          key={d.date}
          style={{ width: size, height: size }}
          className={cn("shrink-0 rounded-full", DOT_CLASS[d.status])}
        />
      ))}
    </div>
  );
}
