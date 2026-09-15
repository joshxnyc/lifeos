import { jobRoute } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { addDays, localDate, localTime } from "@/lib/time";
import type { Routine } from "@/lib/types";

/**
 * Closes off yesterday (SPEC §4.2): every active routine that was scheduled
 * and never logged gets an explicit `missed` row, so streaks and adherence are
 * computed from data rather than from absence.
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

  return {
    date: yesterday,
    scheduled: scheduledYesterday.length,
    already_logged: scheduledYesterday.length - missing.length,
    missed_written: missing.length,
  };
});
