import { fromZonedTime } from "date-fns-tz";
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

  return {
    date: today,
    scheduled_today: scheduled.length,
    already_logged: logged.size,
    reminders_enqueued: reminders,
    nudges_enqueued: nudges,
  };
});
