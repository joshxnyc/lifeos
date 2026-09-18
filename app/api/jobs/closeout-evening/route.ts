import { fromZonedTime } from "date-fns-tz";
import { jobRoute } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { enqueueNotification } from "@/lib/notify";
import { addDays, localDate, localDayOfWeek, localTime, isDueNow } from "@/lib/time";
import { computeStreaks } from "@/lib/domain/streaks";
import type { DailyPlan, Routine, RoutineLog, Task } from "@/lib/types";

const STREAK_HISTORY_DAYS = 120;

/**
 * Evening close-out push (SPEC §8): what got done, whether the top item landed,
 * which routines are still unlogged, what rolls over, and one line when a
 * streak is about to end. Numbers, no adjectives, no exclamation marks
 * (DESIGN_BRIEF §7).
 *
 * Runs every 15 minutes and no-ops unless the local clock just passed
 * settings.evening_closeout_time; daily_plans.closeout_sent_at makes a second
 * pass in the same window a no-op.
 */
export const POST = jobRoute("closeout-evening", async ({ supabase, userId, now }) => {
  const settings = await getSettings(supabase, userId);
  const tz = settings.timezone;
  const nowLocal = localTime(now, tz);
  const today = localDate(now, tz);
  const dow = localDayOfWeek(now, tz);

  if (!isDueNow(nowLocal, settings.evening_closeout_time)) {
    return { skipped: true, local_time: nowLocal, target: settings.evening_closeout_time };
  }

  const { data: planRow } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();
  const plan = planRow as DailyPlan | null;
  if (plan?.closeout_sent_at) return { skipped: true, reason: "already_sent", date: today };

  const dayStart = fromZonedTime(`${today}T00:00:00`, tz).toISOString();
  const dayEnd = fromZonedTime(`${addDays(today, 1)}T00:00:00`, tz).toISOString();

  const [
    { count: completedCount },
    { count: rollingCount },
    { data: routineRows },
    { data: logRows },
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "done")
      .gte("completed_at", dayStart)
      .lt("completed_at", dayEnd),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "open")
      .or(`due_date.eq.${today},scheduled_date.eq.${today}`),
    supabase.from("routines").select("*").eq("user_id", userId).eq("active", true),
    supabase
      .from("routine_logs")
      .select("routine_id, date, status")
      .eq("user_id", userId)
      .gte("date", addDays(today, -(STREAK_HISTORY_DAYS - 1))),
  ]);

  const logs = (logRows ?? []) as Pick<RoutineLog, "routine_id" | "date" | "status">[];
  const loggedToday = new Set(logs.filter((l) => l.date === today).map((l) => l.routine_id));
  const scheduledToday = ((routineRows ?? []) as Routine[]).filter((r) =>
    r.schedule_days.includes(dow),
  );
  const unlogged = scheduledToday.filter((r) => !loggedToday.has(r.id));

  // The longest live streak that today would break.
  const yesterday = addDays(today, -1);
  let atRisk: { name: string; streak: number } | null = null;
  for (const routine of unlogged) {
    const history = logs.filter((l) => l.routine_id === routine.id && l.date <= yesterday);
    const { current } = computeStreaks(history, routine.schedule_days, yesterday);
    if (current > 0 && (!atRisk || current > atRisk.streak)) {
      atRisk = { name: routine.name, streak: current };
    }
  }

  // Top item: Joshua's pick wins over the proposal (SPEC §7.3).
  const topTaskId = plan?.chosen_top_task_id ?? plan?.proposed_top_task_ids?.[0] ?? null;
  let topLine: string | null = null;
  if (topTaskId) {
    const { data: taskRow } = await supabase
      .from("tasks")
      .select("title, status")
      .eq("id", topTaskId)
      .maybeSingle();
    const task = taskRow as Pick<Task, "title" | "status"> | null;
    if (task) topLine = task.status === "done" ? "Top item done." : "Top item not done.";
  }

  const done = completedCount ?? 0;
  const rolling = rollingCount ?? 0;
  const parts = [
    topLine,
    unlogged.length > 0
      ? `${unlogged.length} ${unlogged.length === 1 ? "routine" : "routines"} not logged.`
      : scheduledToday.length > 0
        ? "All routines logged."
        : null,
    rolling > 0 ? `${rolling} ${rolling === 1 ? "task rolls" : "tasks roll"} to tomorrow.` : null,
    atRisk ? `${atRisk.name} streak at ${atRisk.streak}, not logged today.` : null,
  ].filter(Boolean) as string[];

  const scheduledFor = fromZonedTime(`${today}T${settings.evening_closeout_time}:00`, tz);
  const enqueued = await enqueueNotification(supabase, userId, {
    kind: "evening_closeout",
    title: `${done} ${done === 1 ? "task" : "tasks"} done today`,
    body: parts.join(" "),
    url: "/today",
    scheduledFor,
    payload: { date: today },
  });

  await supabase.from("daily_plans").upsert(
    { user_id: userId, date: today, closeout_sent_at: new Date().toISOString() },
    { onConflict: "user_id,date" },
  );

  return {
    date: today,
    enqueued,
    completed: done,
    rolling,
    routines_unlogged: unlogged.length,
    streak_at_risk: atRisk?.name ?? null,
  };
});
