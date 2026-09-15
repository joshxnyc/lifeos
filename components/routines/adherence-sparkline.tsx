import { mondayOf } from "@/lib/time";
import { addDaysStr, dayOfWeek } from "./format";

/**
 * Adherence per week as a hairline sparkline (DESIGN_BRIEF §5.5). Skipped days
 * leave the denominator, matching lib/domain/streaks.completionRate.
 */
export function AdherenceSparkline({
  today,
  scheduleDays,
  logs,
  weeks = 12,
  width = 280,
  height = 44,
}: {
  today: string;
  scheduleDays: number[];
  logs: { date: string; status: "done" | "missed" | "skipped" }[];
  weeks?: number;
  width?: number;
  height?: number;
}) {
  const map = new Map(logs.map((l) => [l.date, l.status]));
  const thisMonday = mondayOf(today);

  const series = Array.from({ length: weeks }, (_, i) => {
    const start = addDaysStr(thisMonday, (i - (weeks - 1)) * 7);
    let due = 0;
    let done = 0;
    for (let d = 0; d < 7; d++) {
      const date = addDaysStr(start, d);
      if (date > today) continue;
      const log = map.get(date);
      if (log === "skipped") continue;
      if (!scheduleDays.includes(dayOfWeek(date)) && log !== "done") continue;
      due += 1;
      if (log === "done") done += 1;
    }
    return { start, rate: due === 0 ? null : done / due };
  });

  const points = series
    .map((s, i) => {
      if (s.rate === null) return null;
      const x = weeks === 1 ? width / 2 : (i / (weeks - 1)) * width;
      const y = height - s.rate * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");

  const latest = [...series].reverse().find((s) => s.rate !== null);

  return (
    <div className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Adherence over the last ${weeks} weeks`}
        className="overflow-visible"
      >
        <line
          x1="0"
          y1={height}
          x2={width}
          y2={height}
          stroke="var(--line)"
          strokeWidth="1"
          shapeRendering="crispEdges"
        />
        {points ? (
          <polyline
            points={points}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
      </svg>
      <p className="tabular text-[11px] text-ink-2">
        {weeks} weeks · latest {latest?.rate != null ? `${Math.round(latest.rate * 100)}%` : "—"}
      </p>
    </div>
  );
}
