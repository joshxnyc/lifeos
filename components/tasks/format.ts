// Date/time formatting for task rows. Everything works on YYYY-MM-DD strings
// that are already in the user's timezone (CONTRACTS ground rule 9) — no
// Date.toISOString() slicing anywhere.

/** Parse a YYYY-MM-DD into a local Date at noon (DST-safe for formatting). */
export function parseDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

/** 0 = Sunday, matching routines.schedule_days. */
export function dayOfWeek(date: string): number {
  return parseDay(date).getDay();
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Tuesday, 15 September" — the Today header line. */
export function formatLongDate(date: string): string {
  const d = parseDay(date);
  return `${WEEKDAY[d.getDay()]}, ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

/** "15 Sep" (adds the year when it differs from `today`). */
export function formatShortDate(date: string, today?: string): string {
  const d = parseDay(date);
  const sameYear = today ? parseDay(today).getFullYear() === d.getFullYear() : true;
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}${sameYear ? "" : ` ${d.getFullYear()}`}`;
}

export function weekdayShort(date: string): string {
  return WEEKDAY_SHORT[parseDay(date).getDay()] ?? "";
}

/** "3pm" / "3:30pm" from a Postgres time value. */
export function formatClock(time: string | null | undefined): string {
  if (!time) return "";
  const [hRaw, mRaw] = time.split(":");
  const h = Number(hRaw ?? 0);
  const m = Number(mRaw ?? 0);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

/** "10:30" — 24h clock for schedule strips. */
export function formatClock24(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

/** Today / Tomorrow / Yesterday / 3d ago / Fri / 15 Sep. */
export function relativeDayLabel(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < -1 && diff >= -7) return `${-diff}d ago`;
  if (diff > 1 && diff < 7) return weekdayShort(date);
  return formatShortDate(date, today);
}

/** The right-aligned due meta on a task row: "Today 3pm", "2d ago", "15 Sep". */
export function formatDueLabel(
  dueDate: string | null,
  dueTime: string | null,
  today: string,
): string {
  if (!dueDate) return "";
  const day = relativeDayLabel(dueDate, today);
  const clock = formatClock(dueTime);
  return clock ? `${day} ${clock}` : day;
}

export type DueTone = "danger" | "warn" | "none";

export function dueTone(dueDate: string | null, today: string): DueTone {
  if (!dueDate) return "none";
  if (dueDate < today) return "danger";
  if (dueDate === today) return "warn";
  return "none";
}

export const DUE_TONE_CLASS: Record<DueTone, string> = {
  danger: "text-danger",
  warn: "text-warn",
  none: "text-ink-2",
};

/** Add days to a YYYY-MM-DD string without touching UTC. */
export function shiftDay(date: string, days: number): string {
  const d = parseDay(date);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The coming Saturday; when today is Saturday or Sunday, the next one. */
export function comingSaturday(today: string): string {
  const dow = dayOfWeek(today);
  let delta = 6 - dow;
  if (delta <= 0) delta += 7;
  return shiftDay(today, delta);
}

/** Monday of next week. */
export function nextMonday(today: string): string {
  const dow = dayOfWeek(today);
  let delta = 1 - dow;
  if (delta <= 0) delta += 7;
  return shiftDay(today, delta);
}

export const PRIORITY_LABEL: Record<number, string> = {
  0: "None",
  1: "Low",
  2: "Medium",
  3: "High",
};
