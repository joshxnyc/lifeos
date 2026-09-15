// Three sparklines carry the review history (DESIGN_BRIEF §5.9): completion,
// on-time, adherence. Inline SVG, one hairline, no axes, no gradient.
export function Sparkline({
  values,
  label,
  suffix = "",
  width = 120,
  height = 28,
}: {
  values: (number | null)[];
  label: string;
  suffix?: string;
  width?: number;
  height?: number;
}) {
  const points = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const latest = points.at(-1);

  if (points.length < 2) {
    return (
      <div>
        <p className="section-label">{label}</p>
        <p className="mt-1 text-[13px] text-ink-2 tabular">
          {latest === undefined ? "Not enough weeks yet" : `${Math.round(latest)}${suffix}`}
        </p>
      </div>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");

  return (
    <div>
      <p className="section-label">{label}</p>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="mt-1 block max-w-full overflow-visible"
        role="img"
        aria-label={`${label}: ${points.map((p) => Math.round(p)).join(", ")}`}
      >
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <p className="mt-0.5 text-[12px] text-ink-2 tabular">
        {latest === undefined ? "" : `now ${Math.round(latest)}${suffix}`}
      </p>
    </div>
  );
}
