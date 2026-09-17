// Task deadline reminders (SPEC §8): a task with due_date + due_time gets one
// push 30 minutes before the due timestamp; a day task (due_date only) gets
// one push at 10:00 local the day before. Pure — schedule-day enqueues from
// this, notifications-tick re-checks with it at send time.

import { fromZonedTime } from "date-fns-tz";
import { addDays } from "@/lib/time";

/** The two columns the reminder is computed from. */
export interface TaskDeadline {
  due_date: string; // YYYY-MM-DD
  due_time: string | null; // HH:mm or HH:mm:ss local time; null = day task
}

export const REMINDER_LEAD_MINUTES = 30;
export const DAY_TASK_REMINDER_TIME = "10:00";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "14:30:00" (Postgres time) → "14:30"; anything unparseable → null. */
export function normalizeDueTime(dueTime: string | null): string | null {
  const t = (dueTime ?? "").slice(0, 5);
  return TIME_RE.test(t) ? t : null;
}

/**
 * When the reminder for this deadline should fire, or null when there is
 * nothing left to remind about.
 *
 * - Timed task: due timestamp minus 30 minutes.
 * - Day task: 10:00 local the day before due_date.
 * - Reminder moment already past but the deadline still ahead (task created
 *   late, job downtime): fire now — `now` is returned. Callers dedupe so this
 *   still means one push.
 * - Deadline past (timed: the due timestamp; day task: the end of the due
 *   day): null. A reminder after the deadline is noise, not help.
 */
export function taskReminderAt(task: TaskDeadline, timeZone: string, now: Date): Date | null {
  if (!DATE_RE.test(task.due_date)) return null;
  const time = normalizeDueTime(task.due_time);

  let deadline: Date;
  let reminder: Date;
  try {
    if (time) {
      deadline = fromZonedTime(`${task.due_date}T${time}:00`, timeZone);
      reminder = new Date(deadline.getTime() - REMINDER_LEAD_MINUTES * 60_000);
    } else {
      deadline = fromZonedTime(`${addDays(task.due_date, 1)}T00:00:00`, timeZone);
      reminder = fromZonedTime(
        `${addDays(task.due_date, -1)}T${DAY_TASK_REMINDER_TIME}:00`,
        timeZone,
      );
    }
  } catch {
    return null; // bad timezone: never enqueue on data we can't place in time
  }

  if (deadline.getTime() <= now.getTime()) return null;
  return reminder.getTime() > now.getTime() ? reminder : new Date(now.getTime());
}

/**
 * The "Due …" prefix for the push title: "Due 14:30" for timed tasks;
 * "Due today" / "Due tomorrow" / "Due 2026-09-21" for day tasks, judged
 * against the local date at enqueue time.
 */
export function taskDueLabel(task: TaskDeadline, localToday: string): string {
  const time = normalizeDueTime(task.due_time);
  if (time) return `Due ${time}`;
  if (task.due_date === localToday) return "Due today";
  if (task.due_date === addDays(localToday, 1)) return "Due tomorrow";
  return `Due ${task.due_date}`;
}
