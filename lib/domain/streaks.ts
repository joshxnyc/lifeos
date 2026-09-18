// Routine streaks and completion rates (SPEC §4.2, §7.5).
//
// Only days in `scheduleDays` count at all. "skipped" is an explicit choice
// (travel, sick): it is transparent to streaks and excluded from the rate's
// denominator. "missed" — and a scheduled day in the past with no log, which
// routines-nightly turns into a missed row overnight — breaks a streak and
// counts against the rate. Today with no log yet is still pending, so it
// neither breaks a streak nor counts against the rate.

import type { RoutineLog } from "@/lib/types";
import { addDays } from "@/lib/time";
import { dayOfWeekOf, diffDays, eachDate } from "@/lib/domain/dates";

type Log = Pick<RoutineLog, "date" | "status">;

/** Guards against a corrupt log date sending the walk back through millennia. */
const MAX_DAYS_SCANNED = 4000;

function index(logs: Log[], today: string): { byDate: Map<string, Log["status"]>; earliest: string | null } {
  const byDate = new Map<string, Log["status"]>();
  let earliest: string | null = null;
  for (const log of logs) {
    if (diffDays(log.date, today) < 0) continue; // ignore anything dated after today
    byDate.set(log.date, log.status); // last row for a date wins
    if (earliest === null || log.date < earliest) earliest = log.date;
  }
  const floor = addDays(today, -MAX_DAYS_SCANNED);
  if (earliest !== null && earliest < floor) earliest = floor;
  return { byDate, earliest };
}

export function computeStreaks(
  logs: Log[],
  scheduleDays: number[],
  today: string,
): { current: number; best: number } {
  const scheduled = new Set(scheduleDays);
  const { byDate, earliest } = index(logs, today);
  if (!scheduled.size || earliest === null) return { current: 0, best: 0 };

  const days = eachDate(earliest, today);

  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const date = days[i];
    if (!date || !scheduled.has(dayOfWeekOf(date))) continue;
    const status = byDate.get(date);
    if (status === "done") current++;
    else if (status === "skipped") continue;
    else if (!status && date === today) continue; // not logged yet
    else break; // missed, including an explicit missed row for today
  }

  let best = 0;
  let run = 0;
  for (const date of days) {
    if (!scheduled.has(dayOfWeekOf(date))) continue;
    const status = byDate.get(date);
    if (status === "done") {
      run++;
      if (run > best) best = run;
    } else if (status === "skipped" || (!status && date === today)) {
      continue;
    } else {
      run = 0;
    }
  }

  return { current, best: Math.max(best, current) };
}

/** Share of scheduled, non-skipped days in the last `days` days that were done. 0..1. */
export function completionRate(
  logs: Log[],
  scheduleDays: number[],
  today: string,
  days: number,
): number {
  const scheduled = new Set(scheduleDays);
  if (!scheduled.size || days <= 0) return 0;
  const { byDate } = index(logs, today);

  let done = 0;
  let denominator = 0;
  for (const date of eachDate(addDays(today, -(days - 1)), today)) {
    if (!scheduled.has(dayOfWeekOf(date))) continue;
    const status = byDate.get(date);
    if (status === "skipped") continue;
    if (!status && date === today) continue; // pending
    denominator++;
    if (status === "done") done++;
  }
  return denominator === 0 ? 0 : done / denominator;
}
