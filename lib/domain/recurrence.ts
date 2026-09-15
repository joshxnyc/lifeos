// Recurrence spawning (SPEC §4.2): completing a task with a recurrence_rule
// creates the next occurrence. Dates are floating local calendar dates, so the
// rule is evaluated entirely in UTC and only the Y/M/D fields are read back.
//
// rrule@2 silently falls back to `new Date()` for DTSTART it cannot parse
// (`DTSTART;VALUE=DATE:20260901` is one such form), which would make this
// function impure. So the DTSTART line is parsed here, stripped from the
// string, and passed explicitly — and when the rule carries none, the rule is
// anchored on `after` itself, which is what "next one after this one" means.

import { rrulestr } from "rrule";
import { formatDateParts, isDateString } from "@/lib/domain/dates";

const DTSTART_LINE = /^DTSTART[^:\r\n]*:\s*([0-9TZ:+\-]+)\s*$/im;

function parseDtstart(value: string): Date | null {
  const compact = value.trim().replace(/[-:]/g, "");
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?Z?$/.exec(compact);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDayUtc(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59.999Z`);
}

/** Next occurrence strictly after `after` (YYYY-MM-DD), or null when the rule is exhausted or invalid. */
export function nextOccurrence(rrule: string, after: string): string | null {
  if (!isDateString(after)) return null;
  const text = rrule.replace(/\r\n/g, "\n").trim();
  if (!text) return null;

  const dtstartMatch = DTSTART_LINE.exec(text);
  const dtstart = dtstartMatch?.[1] ? parseDtstart(dtstartMatch[1]) : null;
  const body = dtstartMatch ? text.replace(DTSTART_LINE, "").trim() : text;
  if (!body) return null;

  try {
    const rule = rrulestr(body, { dtstart: dtstart ?? new Date(`${after}T00:00:00Z`) });
    let cursor = endOfDayUtc(after);
    for (let guard = 0; guard < 8; guard++) {
      const next = rule.after(cursor, false);
      if (!next) return null;
      const date = formatDateParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
      if (date > after) return date;
      cursor = new Date(next.getTime() + 1);
    }
    return null;
  } catch {
    return null;
  }
}
