import { cn } from "@/lib/utils";

/**
 * The big Fraunces number on a routine tile (DESIGN_BRIEF §6). A live streak
 * is ink; zero is ink-2 so a cold routine reads quieter without shouting.
 */
export function StreakNumber({
  value,
  unit = "day streak",
  size = 34,
  className,
}: {
  value: number;
  unit?: string;
  size?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline gap-1.5", className)}>
      <span
        style={{ fontSize: size, lineHeight: 1 }}
        className={cn(
          "font-display tabular font-semibold tracking-tight",
          value > 0 ? "text-ink" : "text-ink-2",
        )}
      >
        {value}
      </span>
      <span className="text-[11px] text-ink-2">{unit}</span>
    </div>
  );
}
