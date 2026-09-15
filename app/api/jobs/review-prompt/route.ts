import { fromZonedTime } from "date-fns-tz";
import { jobRoute } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { enqueueNotification } from "@/lib/notify";
import { localDate, localDayOfWeek, localTime, isDueNow, mondayOf } from "@/lib/time";

const REPEAT_HOURS = 3;

/**
 * Weekly review prompt (SPEC §8) with real counts, plus one repeat three hours
 * later. notifications-tick cancels the repeat once the review is under way,
 * so it never nags about something already being done.
 */
export const POST = jobRoute("review-prompt", async ({ supabase, userId, now }) => {
  const settings = await getSettings(supabase, userId);
  const tz = settings.timezone;
  const nowLocal = localTime(now, tz);
  const today = localDate(now, tz);

  if (localDayOfWeek(now, tz) !== settings.weekly_review_day) {
    return { skipped: true, reason: "wrong_day", local_date: today };
  }
  if (!isDueNow(nowLocal, settings.weekly_review_time)) {
    return { skipped: true, reason: "not_due", local_time: nowLocal };
  }

  const weekStart = mondayOf(today);
  const { data: review } = await supabase
    .from("weekly_reviews")
    .select("status, step_reached")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (review && (review.status === "done" || (review.step_reached ?? 1) > 1)) {
    return { skipped: true, reason: "already_started", week_start: weekStart };
  }

  const dormantBefore = new Date(
    now.getTime() - settings.dormancy_days * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [{ count: slipped }, { count: dormant }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "open")
      .lt("due_date", today),
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "active")
      .lt("last_activity_at", dormantBefore),
  ]);

  const slippedCount = slipped ?? 0;
  const dormantCount = dormant ?? 0;
  const body = `${slippedCount} ${slippedCount === 1 ? "task" : "tasks"} slipped, ${dormantCount} ${dormantCount === 1 ? "project" : "projects"} dormant.`;

  const scheduledFor = fromZonedTime(`${today}T${settings.weekly_review_time}:00`, tz);
  const first = await enqueueNotification(supabase, userId, {
    kind: "review_prompt",
    title: "Weekly review is ready",
    body,
    url: "/review",
    scheduledFor,
    payload: { week_start: weekStart },
  });

  const repeat = await enqueueNotification(supabase, userId, {
    kind: "review_prompt",
    title: "Weekly review is still waiting",
    body,
    url: "/review",
    scheduledFor: new Date(scheduledFor.getTime() + REPEAT_HOURS * 60 * 60 * 1000),
    payload: { week_start: weekStart, repeat: true },
  });

  return { week_start: weekStart, slipped: slippedCount, dormant: dormantCount, first, repeat };
});
