import { cn } from "@/lib/utils";

// Three sparklines carry the review history (DESIGN_BRIEF §5.9): completion,
// on-time, adherence. Canvas 2g draws them as bars on a hairline baseline —
// every week in `line`, this week coloured by which way it moved — with the
// current value in Fraunces underneath. No axes, no gradient.
export function Sparkline({
  values,
  label,
  suffix = "",
  goodDirection = "up",
  height = 36,
}: {
  values: (number | null)[];
  label: string;
  suffix?: string;
  /** Which way counts as progress, so the last bar can be read at a glance. */
  goodDirection?: "up" | "down";
  height?: number;
}) {
  const points = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const latest = points.at(-1);

  if (points.length < 2) {
    return (
      <div>
        <p className="section-label">{label}</p>
        <p className="tabular mt-1 text-[13px] text-ink-2">
          {latest === undefined ? "Not enough weeks yet" : `${Math.round(latest)}${suffix}`}
        </p>
      </div>
    );
  }

  const max = Math.max(...points, 1);
  const previous = points.at(-2) ?? latest ?? 0;
  const rose = (latest ?? 0) >= previous;
  const good = goodDirection === "up" ? rose : !rose;

  return (
    <div>
      <p className="section-label">{label}</p>
      <div
        style={{ height }}
        className="mt-2 flex items-end gap-[3px] border-b border-line"
        role="img"
        aria-label={`${label}: ${points.map((p) => Math.round(p)).join(", ")}`}
      >
        {points.map((v, i) => (
          <span
            key={i}
            style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
            className={cn(
              "flex-1 rounded-t-[2px]",
              i === points.length - 1 ? (good ? "bg-ok" : "bg-danger") : "bg-line",
            )}
          />
        ))}
      </div>
      <p className="tabular mt-1.5 font-display text-[17px] text-ink">
        {latest === undefined ? "" : `${Math.round(latest)}${suffix}`}
      </p>
    </div>
  );
}
