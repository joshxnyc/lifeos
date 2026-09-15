// Pure formatting helpers shared by the routines screens. No I/O, no JSX.

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** Mon-first order, matching the detail heatmap's columns. */
export const WEEK_ORDER: number[] = [1, 2, 3, 4, 5, 6, 0];

/** "Mon–Fri", "Every day", "Mon, Wed, Sat". */
export function scheduleSummary(days: number[]): string {
  const set = new Set(days);
  if (set.size === 0) return "No days";
  if (set.size === 7) return "Every day";
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return "Mon–Fri";
  if (set.size === 2 && set.has(0) && set.has(6)) return "Sat, Sun";

  const ordered = WEEK_ORDER.filter((d) => set.has(d));
  const runs: number[][] = [];
  for (const day of ordered) {
    const last = runs[runs.length - 1];
    const prevIndex = last ? WEEK_ORDER.indexOf(last[last.length - 1]) : -2;
    if (last && WEEK_ORDER.indexOf(day) === prevIndex + 1) last.push(day);
    else runs.push([day]);
  }
  return runs
    .map((run) =>
      run.length >= 3
        ? `${DAY_LABELS[run[0]]}–${DAY_LABELS[run[run.length - 1]]}`
        : run.map((d) => DAY_LABELS[d]).join(", "),
    )
    .join(", ");
}

/** Postgres `time` comes back as "07:30:00"; show "07:30". */
export function shortTime(value: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 5);
}

/** "Mon–Fri · 07:30" */
export function scheduleLine(days: number[], reminderTime: string | null): string {
  const time = shortTime(reminderTime);
  return time ? `${scheduleSummary(days)} · ${time}` : scheduleSummary(days);
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0–6 (Sunday = 0) for a YYYY-MM-DD string, read as a plain calendar date. */
export function dayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** "15 Sep" — compact, no year. */
export function shortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}`;
}

export type DotStatus = "done" | "skipped" | "missed" | "pending" | "off";

/**
 * Status of one day in a routine's strip: an explicit log wins, an unlogged
 * scheduled day in the past reads as missed even before routines-nightly has
 * written the row, today stays pending, and unscheduled or future days are
 * faint.
 */
export function dayStatus(
  date: string,
  today: string,
  scheduleDays: number[],
  logs: Map<string, "done" | "missed" | "skipped">,
): DotStatus {
  const log = logs.get(date);
  if (log) return log;
  if (!scheduleDays.includes(dayOfWeek(date))) return "off";
  if (date > today) return "off";
  if (date === today) return "pending";
  return "missed";
}

/** The last `count` dates ending today, oldest first. */
export function lastDates(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDaysStr(today, i - (count - 1)));
}
