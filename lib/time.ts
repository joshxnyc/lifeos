// Timezone helpers shared by jobs and UI. All "local" means the user's
// configured timezone (settings.timezone, default APP_TIMEZONE).

import { formatInTimeZone } from "date-fns-tz";

/** YYYY-MM-DD in the given timezone. */
export function localDate(now: Date, timeZone: string): string {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

/** HH:mm in the given timezone. */
export function localTime(now: Date, timeZone: string): string {
  return formatInTimeZone(now, timeZone, "HH:mm");
}

/** 0–6, Sunday = 0, in the given timezone (matches routines.schedule_days). */
export function localDayOfWeek(now: Date, timeZone: string): number {
  return Number(formatInTimeZone(now, timeZone, "i")) % 7; // ISO 1–7, Mon=1 → Sun(7)%7=0
}

/** Monday of the week containing `date` (YYYY-MM-DD), per weekly_reviews.week_start. */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Add days to a YYYY-MM-DD string. */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * True when a job scheduled for a local time-of-day should fire on this tick:
 * the target time falls within (lastTick, now] in local time. Ticks run every
 * 15 minutes, so we check "now is within 15 minutes after target".
 *
 * The comparison is modular over the 1440-minute day, so a target in the last
 * window before midnight (23:50 with 15-minute ticks) still fires on the 00:00
 * tick instead of being skipped by a negative day-wide difference.
 */
export function isDueNow(nowHHmm: string, targetHHmm: string, windowMinutes = 15): boolean {
  const toMin = (s: string) => {
    const [h = 0, m = 0] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const now = toMin(nowHHmm);
  const target = toMin(targetHHmm);
  const diff = (((now - target) % 1440) + 1440) % 1440;
  return diff < windowMinutes;
}
