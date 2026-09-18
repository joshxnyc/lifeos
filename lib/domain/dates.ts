// Floating calendar-date helpers for the pure domain functions. A "date" here
// is always a YYYY-MM-DD string already expressed in the user's timezone, so
// every computation runs on UTC-anchored Dates and never crosses a DST or
// offset boundary. Use lib/time.ts to get such a string out of a timestamp.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

/** 0–6, Sunday = 0 — matches routines.schedule_days. */
export function dayOfWeekOf(dateStr: string): number {
  return toUtc(dateStr).getUTCDay();
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** Inclusive list of dates; empty when end < start. */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const total = diffDays(start, end);
  if (total < 0) return out;
  const d = toUtc(start);
  for (let i = 0; i <= total; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** YYYY-MM-DD from already-local year/month/day numbers (month is 1-based). */
export function formatDateParts(year: number, month: number, day: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${p(month)}-${p(day)}`;
}
