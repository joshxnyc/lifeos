import { cn } from "@/lib/utils";
import { mondayOf } from "@/lib/time";
import { DAY_INITIALS, WEEK_ORDER, addDaysStr, dayStatus, shortDate, type DotStatus } from "./format";

const CELL_CLASS: Record<DotStatus, string> = {
  done: "bg-ok",
  skipped: "border border-ink-3 bg-transparent",
  missed: "bg-danger",
  pending: "border border-ink-2/50 bg-transparent",
  off: "bg-line/60",
};

/**
 * Weeks as rows, Mon–Sun as columns, so a column that is mostly `danger` shows
 * the pattern at a glance — "gym misses cluster on Thursdays" (DESIGN_BRIEF
 * §5.5). The footer counts misses per weekday to say it in numbers too.
 */
export function RoutineHeatmap({
  today,
  scheduleDays,
  logs,
  weeks = 12,
}: {
  today: string;
  scheduleDays: number[];
  logs: { date: string; status: "done" | "missed" | "skipped" }[];
  weeks?: number;
}) {
  const map = new Map(logs.map((l) => [l.date, l.status]));
  const thisMonday = mondayOf(today);
  const rows = Array.from({ length: weeks }, (_, i) => {
    const start = addDaysStr(thisMonday, (i - (weeks - 1)) * 7);
    return {
      start,
      cells: WEEK_ORDER.map((_, offset) => {
        const date = addDaysStr(start, offset);
        return { date, status: dayStatus(date, today, scheduleDays, map) };
      }),
    };
  });

  const missesByColumn = WEEK_ORDER.map(
    (_, col) => rows.filter((r) => r.cells[col]?.status === "missed").length,
  );

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[3px] text-left">
        <caption className="sr-only">
          Last {weeks} weeks, one row per week, Monday to Sunday
        </caption>
        <thead>
          <tr>
            <th className="w-12" />
            {WEEK_ORDER.map((d, i) => (
              <th key={i} scope="col" className="section-label pb-1 text-center font-normal">
                {DAY_INITIALS[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.start}>
              <th
                scope="row"
                className="tabular pr-1 text-right text-[11px] font-normal text-ink-2"
              >
                {shortDate(row.start)}
              </th>
              {row.cells.map((cell) => (
                <td key={cell.date} className="p-0">
                  <span
                    title={`${cell.date} · ${cell.status}`}
                    className={cn("block size-[18px] rounded-[3px]", CELL_CLASS[cell.status])}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="section-label pt-1 pr-1 text-right font-normal">
              Miss
            </th>
            {missesByColumn.map((count, i) => (
              <td
                key={i}
                className={cn(
                  "tabular pt-1 text-center text-[11px]",
                  count > 0 ? "text-ink-2" : "text-ink-3",
                )}
              >
                {count}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
