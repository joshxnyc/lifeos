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
  height = 56,
}: {
  today: string;
  scheduleDays: number[];
  logs: { date: string; status: "done" | "missed" | "skipped" }[];
  weeks?: number;
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

  const latest = [...series].reverse().find((s) => s.rate !== null);

  // Canvas 1i: bars on a hairline baseline, this week picked out in `ok`.
  return (
    <div className="flex flex-col gap-3">
      <div
        style={{ height }}
        className="flex items-end gap-1.5 border-b border-line"
        role="img"
        aria-label={`Adherence over the last ${weeks} weeks`}
      >
        {series.map((s, i) => (
          <span
            key={s.start}
            style={{ height: s.rate === null ? "4%" : `${Math.max(4, s.rate * 100)}%` }}
            className={`flex-1 rounded-t-[2px] ${i === series.length - 1 ? "bg-ok" : "bg-line"}`}
          />
        ))}
      </div>
      <p className="tabular text-[13px] text-ink-2">
        {weeks} weeks · this week {latest?.rate != null ? `${Math.round(latest.rate * 100)}%` : "—"}
      </p>
    </div>
  );
}
