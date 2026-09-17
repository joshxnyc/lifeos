import { cn } from "@/lib/utils";

// StatTile (DESIGN_BRIEF §6): Fraunces number, small delta against the 4-week
// average, glyph colored by whether that direction is good.
export function StatTile({
  label,
  value,
  suffix,
  delta,
  goodDirection = "up",
  noHistory = false,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  delta?: number | null;
  goodDirection?: "up" | "down";
  /** First week on record: there is no 4-week average to compare against. */
  noHistory?: boolean;
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta) && Math.abs(delta) >= 0.05;
  const up = (delta ?? 0) > 0;
  const good = hasDelta ? (goodDirection === "up" ? up : !up) : false;

  return (
    // Canvas 1m: hairline card on paper, the number first at 34px, the label
    // under it, then the delta against the four-week average.
    <div className="rounded-card border border-line p-3.5">
      <p className="display-number">
        {value}
        {suffix ? <span className="text-[20px]">{suffix}</span> : null}
      </p>
      <p className="mt-1.5 text-[13px] text-ink-2">{label}</p>
      <p
        className={cn(
          "tabular mt-0.5 text-[13px]",
          hasDelta ? (good ? "text-ok" : "text-danger") : "text-ink-2",
        )}
      >
        {hasDelta
          ? `${up ? "↑" : "↓"} ${Math.abs(Math.round((delta ?? 0) * 10) / 10)}${suffix ?? ""} vs 4-wk avg`
          : noHistory
            ? "first week"
            : "level vs 4-wk avg"}
      </p>
    </div>
  );
}
