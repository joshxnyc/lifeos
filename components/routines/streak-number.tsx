import { cn } from "@/lib/utils";

/**
 * The big Fraunces number on a routine tile (DESIGN_BRIEF §6). A live streak
 * is ink; zero is ink-2 so a cold routine reads quieter without shouting.
 */
export function StreakNumber({
  value,
  unit,
  size = 34,
  tone = "ink",
  className,
}: {
  value: number;
  /** Canvas 1h shows the bare number; a unit only where it disambiguates. */
  unit?: string;
  size?: number;
  tone?: "ink" | "ok" | "warn";
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline gap-2", className)}>
      <span
        style={{ fontSize: size }}
        className={cn(
          "display-number",
          tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : value > 0 ? "text-ink" : "text-ink-2",
        )}
      >
        {value}
      </span>
      {unit ? <span className="text-[12px] text-ink-2">{unit}</span> : null}
    </div>
  );
}
