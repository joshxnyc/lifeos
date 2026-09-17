import { fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jobRoute } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { enqueueNotification } from "@/lib/notify";
import { normalizeDueTime, taskDueLabel, taskReminderAt } from "@/lib/domain/task-reminders";
import { addDays, localDate, localDayOfWeek } from "@/lib/time";
import type { Routine, Task } from "@/lib/types";

/**
 * Lays down today's routine pushes and task deadline pushes (SPEC §8,
 * CONTRACTS notifications matrix). Runs every 15 minutes rather than once, so
 * a routine or task created at 10am still gets its reminder today. Every row
 * is keyed on an exact local timestamp, so re-running enqueues nothing new:
 * the unique dedupe index catches it and enqueueNotification swallows the
 * 23505.
 */
export const POST = jobRoute("schedule-day", async ({ supabase, userId, now }) => {
  const settings = await getSettings(supabase, userId);
  const tz = settings.timezone;
  const today = localDate(now, tz);
  const dow = localDayOfWeek(now, tz);

  const [{ data: routineRows }, { data: logRows }] = await Promise.all([
    supabase
      .from("routines")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true)
      .not("reminder_time", "is", null),
    supabase.from("routine_logs").select("routine_id").eq("user_id", userId).eq("date", today),
  ]);

  const logged = new Set((logRows ?? []).map((l: { routine_id: string }) => l.routine_id));
  const scheduled = ((routineRows ?? []) as Routine[]).filter(
    (r) => r.schedule_days.includes(dow) && !logged.has(r.id),
  );

  // A time that has already passed would fire on the next tick, hours late.
  const floor = now.getTime() - 60_000;
  let reminders = 0;
  let nudges = 0;

  for (const routine of scheduled) {
    const time = (routine.reminder_time ?? "").slice(0, 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;

    const reminderAt = fromZonedTime(`${today}T${time}:00`, tz);
    if (reminderAt.getTime() >= floor) {
      const created = await enqueueNotification(supabase, userId, {
        kind: "routine_reminder",
        title: `${routine.name} — tap when done`,
        body: "",
        url: "/routines",
        scheduledFor: reminderAt,
        payload: { routine_id: routine.id, date: today },
      });
      if (created) reminders += 1;
    }

    if (!routine.nudge_enabled) continue;
    const missedAt = new Date(reminderAt.getTime() + routine.grace_minutes * 60_000);
    if (missedAt.getTime() < floor) continue;

    const created = await enqueueNotification(supabase, userId, {
      kind: "routine_missed",
      title: `${routine.name} not logged.`,
      body: "Done, or skip today?",
      url: "/routines",
      scheduledFor: missedAt,
      payload: { routine_id: routine.id, date: today },
    });
    if (created) nudges += 1;
  }

  const taskReminders = await enqueueTaskReminders(supabase, userId, tz, today, now);

  return {
    date: today,
    scheduled_today: scheduled.length,
    already_logged: logged.size,
    reminders_enqueued: reminders,
    nudges_enqueued: nudges,
    task_reminders_enqueued: taskReminders,
  };
});

/**
 * One push per task deadline: 30 minutes before a timed deadline, 10:00 local
 * the day before for a day task (lib/domain/task-reminders). Only open,
 * owner-'me', non-mirror tasks — mirrored Tarifa tasks live in Notion and are
 * not the app's to nag about.
 *
 * Dedupe is two layers. dedupeDaily on payload.routine_id = "task_due:<id>"
 * means at most one push per task per local day even when a late reminder is
 * clamped to `now` (a fresh timestamp every run). The `covered` set below
 * closes the remaining gap — a deadline just after midnight whose reminder
 * fired the evening before lands on a new local day, so daily dedupe alone
 * would let a second row through; one reminder per (task, deadline) is the
 * rule, so any existing task_due row for the same due stamp skips the task.
 */
async function enqueueTaskReminders(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  today: string,
  now: Date,
): Promise<number> {
  const { data: taskRows } = await supabase
    .from("tasks")
    .select("id, title, due_date, due_time, status, owner, is_mirror")
    .eq("user_id", userId)
    .eq("status", "open")
    .eq("owner", "me")
    .eq("is_mirror", false)
    .not("due_date", "is", null)
    .gte("due_date", addDays(today, -1))
    .lte("due_date", addDays(today, 2));

  const tasks = (taskRows ?? []) as Pick<
    Task,
    "id" | "title" | "due_date" | "due_time" | "status" | "owner" | "is_mirror"
  >[];
  if (tasks.length === 0) return 0;

  // Every reminder for a deadline in the window was scheduled at most three
  // local days ago (day-before at 10:00 for a day task due +2); anything older
  // is for a deadline that has passed and computes to null anyway.
  const { data: existingRows } = await supabase
    .from("notifications")
    .select("payload")
    .eq("user_id", userId)
    .eq("kind", "task_due")
    .gte("scheduled_for", fromZonedTime(`${addDays(today, -3)}T00:00:00`, tz).toISOString());
  const covered = new Set(
    (existingRows ?? []).map((r: { payload: Record<string, unknown> }) =>
      [r.payload?.task_id, r.payload?.due_date, r.payload?.due_time ?? ""].join("|"),
    ),
  );

  let enqueued = 0;
  for (const task of tasks) {
    if (!task.due_date) continue;
    const deadline = { due_date: task.due_date, due_time: task.due_time };
    const reminderAt = taskReminderAt(deadline, tz, now);
    if (!reminderAt) continue;

    const dueTime = normalizeDueTime(task.due_time);
    if (covered.has([task.id, task.due_date, dueTime ?? ""].join("|"))) continue;

    const created = await enqueueNotification(supabase, userId, {
      kind: "task_due",
      title: `${taskDueLabel(deadline, today)} · ${task.title}`,
      body: "",
      url: `/tasks?task=${task.id}`,
      scheduledFor: reminderAt,
      payload: {
        routine_id: `task_due:${task.id}`, // keys the dedupe index
        task_id: task.id,
        due_date: task.due_date,
        due_time: dueTime,
      },
      dedupeDaily: true,
    });
    if (created) enqueued += 1;
  }
  return enqueued;
}
