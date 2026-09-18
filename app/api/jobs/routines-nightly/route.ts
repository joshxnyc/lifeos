import { jobRoute } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { addDays, localDate, localTime } from "@/lib/time";
import type { Routine } from "@/lib/types";

// Log tables grow without bound otherwise: the minutely crons alone write
// ~2,880 job_runs a day. Old rows carry no decisions, so they go; ai_calls
// keeps 6 months so the Settings spend view stays meaningful.
const JOB_RUNS_KEEP_DAYS = 30;
const AI_CALLS_KEEP_DAYS = 180;

/**
 * Closes off yesterday (SPEC §4.2): every active routine that was scheduled
 * and never logged gets an explicit `missed` row, so streaks and adherence are
 * computed from data rather than from absence. Also prunes the job_runs and
 * ai_calls logs.
 *
 * pg_cron runs this every 15 minutes in UTC; it only acts in the first half
 * hour of the local day, and is idempotent if it runs twice in that window.
 */
export const POST = jobRoute("routines-nightly", async ({ supabase, userId, now }) => {
  const settings = await getSettings(supabase, userId);
  const tz = settings.timezone;
  const nowLocal = localTime(now, tz);
  if (nowLocal > "00:30") return { skipped: true, local_time: nowLocal };

  const yesterday = addDays(localDate(now, tz), -1);
  const dow = new Date(`${yesterday}T00:00:00Z`).getUTCDay();

  const [{ data: routineRows }, { data: logRows }] = await Promise.all([
    supabase.from("routines").select("*").eq("user_id", userId).eq("active", true),
    supabase.from("routine_logs").select("routine_id").eq("user_id", userId).eq("date", yesterday),
  ]);

  const logged = new Set((logRows ?? []).map((l: { routine_id: string }) => l.routine_id));
  const scheduledYesterday = ((routineRows ?? []) as Routine[]).filter((r) =>
    r.schedule_days.includes(dow),
  );
  const missing = scheduledYesterday.filter((r) => !logged.has(r.id));

  if (missing.length > 0) {
    const { error } = await supabase.from("routine_logs").upsert(
      missing.map((r) => ({
        user_id: userId,
        routine_id: r.id,
        date: yesterday,
        status: "missed",
      })),
      { onConflict: "routine_id,date", ignoreDuplicates: true },
    );
    if (error) throw new Error(`routines-nightly: ${error.message}`);
  }

  const cutoff = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const [jobRunsGone, aiCallsGone] = await Promise.all([
    supabase
      .from("job_runs")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .lt("started_at", cutoff(JOB_RUNS_KEEP_DAYS)),
    supabase
      .from("ai_calls")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .lt("created_at", cutoff(AI_CALLS_KEEP_DAYS)),
  ]);
  if (jobRunsGone.error) throw new Error(`job_runs retention: ${jobRunsGone.error.message}`);
  if (aiCallsGone.error) throw new Error(`ai_calls retention: ${aiCallsGone.error.message}`);

  return {
    date: yesterday,
    scheduled: scheduledYesterday.length,
    already_logged: scheduledYesterday.length - missing.length,
    missed_written: missing.length,
    job_runs_deleted: jobRunsGone.count ?? 0,
    ai_calls_deleted: aiCallsGone.count ?? 0,
  };
});
