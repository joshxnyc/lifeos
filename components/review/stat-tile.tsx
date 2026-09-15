import { cn } from "@/lib/utils";

// StatTile (DESIGN_BRIEF §6): Fraunces number, small delta against the 4-week
// average, glyph colored by whether that direction is good.
export function StatTile({
  label,
  value,
  suffix,
  delta,
  goodDirection = "up",
}: {
  label: string;
  value: number | string;
  suffix?: string;
  delta?: number | null;
  goodDirection?: "up" | "down";
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta) && Math.abs(delta) >= 0.05;
  const up = (delta ?? 0) > 0;
  const good = hasDelta ? (goodDirection === "up" ? up : !up) : false;

  return (
    <div className="rounded-card border border-line bg-paper-2 p-3">
      <p className="section-label">{label}</p>
      <p className="mt-1 font-display text-[28px] font-semibold leading-none tracking-tight tabular">
        {value}
        {suffix ? <span className="ml-0.5 text-[17px] text-ink-2">{suffix}</span> : null}
      </p>
      <p className={cn("mt-1 h-4 text-[12px] tabular", hasDelta ? (good ? "text-ok" : "text-danger") : "text-ink-2")}>
        {hasDelta
          ? `${up ? "↑" : "↓"} ${Math.abs(Math.round((delta ?? 0) * 10) / 10)}${suffix ?? ""} vs 4-week average`
          : "flat vs 4-week average"}
      </p>
    </div>
  );
}
