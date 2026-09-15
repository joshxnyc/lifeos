import { jobRoute } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { getJsonSetting } from "@/lib/integrations/settings-json";
import type { NotificationToggles } from "@/lib/integrations/notification-kinds";
import { isInQuietHours } from "@/lib/notify";
import { sendPushToAllDevices } from "@/lib/push";
import { localDate, localTime, mondayOf } from "@/lib/time";
import type { NotificationRow } from "@/lib/types";

const BATCH = 25;

/**
 * The only sender (CONTRACTS, SPEC §8). Every minute: take the due `scheduled`
 * rows, drop the ones that have been overtaken by events, respect quiet hours,
 * send the rest.
 *
 * Quiet hours differ by kind on purpose: routine nudges and reminders are
 * dropped rather than delayed, because a 06:30 buzz about last night's
 * vitamins is noise. Everything else is left `scheduled` and goes out on the
 * first tick after quiet hours end.
 */
export const POST = jobRoute("notifications-tick", async ({ supabase, userId, now }) => {
  const settings = await getSettings(supabase, userId);
  const tz = settings.timezone;
  const quiet = isInQuietHours(localTime(now, tz), settings.quiet_hours);
  // Per-kind toggles from Settings → Notifications; a missing key means on.
  const toggles = await getJsonSetting<NotificationToggles>(
    supabase,
    userId,
    "notification_kind_toggles",
    {},
  );

  const dueBefore = now.toISOString();
  const ROUTINE_KINDS = ["routine_reminder", "routine_missed"];

  // During quiet hours only the routine kinds can do anything (they get
  // cancelled); everything else is held until quiet hours end. Loading those
  // held rows would let them fill the batch and starve the routine rows they
  // sit in front of, so they are counted, not fetched.
  let query = supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .lte("scheduled_for", dueBefore)
    .order("scheduled_for", { ascending: true })
    .limit(BATCH);
  if (quiet) query = query.in("kind", ROUTINE_KINDS);

  const { data } = await query;

  const due = (data ?? []) as NotificationRow[];
  let sent = 0;
  let cancelled = 0;
  let failed = 0;
  let held = 0;

  if (quiet) {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "scheduled")
      .lte("scheduled_for", dueBefore)
      .not("kind", "in", `(${ROUTINE_KINDS.join(",")})`);
    held = count ?? 0;
  }

  const setStatus = async (id: string, patch: Record<string, unknown>) => {
    await supabase.from("notifications").update(patch).eq("id", id);
  };

  for (const n of due) {
    const routineId =
      typeof n.payload?.routine_id === "string" ? (n.payload.routine_id as string) : null;
    // schedule-day stamps the day the row belongs to, which is not always the
    // day it fires on: a nudge for a 23:00 routine lands after midnight.
    const localDay =
      typeof n.payload?.date === "string"
        ? (n.payload.date as string)
        : localDate(new Date(n.scheduled_for), tz);

    if (toggles[n.kind] === false) {
      await setStatus(n.id, { status: "cancelled" });
      cancelled += 1;
      continue;
    }

    if (n.kind === "routine_reminder" || n.kind === "routine_missed") {
      if (routineId) {
        const { data: log } = await supabase
          .from("routine_logs")
          .select("id")
          .eq("routine_id", routineId)
          .eq("date", localDay)
          .maybeSingle();
        if (log) {
          await setStatus(n.id, { status: "cancelled" });
          cancelled += 1;
          continue;
        }
      }
      if (quiet) {
        await setStatus(n.id, { status: "cancelled" });
        cancelled += 1;
        continue;
      }
    } else if (quiet) {
      // Already counted above and never fetched during quiet hours; the guard
      // stays as a backstop in case the query ever widens again.
      continue;
    }

    // The 3h repeat exists only until the review is actually under way.
    if (n.kind === "review_prompt" && n.payload?.repeat === true) {
      const weekStart =
        typeof n.payload?.week_start === "string"
          ? (n.payload.week_start as string)
          : mondayOf(localDay);
      const { data: review } = await supabase
        .from("weekly_reviews")
        .select("status, step_reached")
        .eq("user_id", userId)
        .eq("week_start", weekStart)
        .maybeSingle();
      if (review && (review.status === "done" || (review.step_reached ?? 1) > 1)) {
        await setStatus(n.id, { status: "cancelled" });
        cancelled += 1;
        continue;
      }
    }

    try {
      const delivered = await sendPushToAllDevices(
        supabase,
        userId,
        {
          title: n.title,
          body: n.body,
          url: n.url,
          tag: routineId ? `${n.kind}-${routineId}` : n.kind,
        },
        { pushoverEnabled: settings.pushover_enabled },
      );
      if (delivered > 0 || settings.pushover_enabled) {
        await setStatus(n.id, { status: "sent", sent_at: new Date().toISOString() });
        sent += 1;
      } else {
        // Nothing accepted it: honest in the history rather than a silent "sent".
        await setStatus(n.id, { status: "failed" });
        failed += 1;
      }
    } catch {
      await setStatus(n.id, { status: "failed" });
      failed += 1;
    }
  }

  return { due: due.length, sent, cancelled, failed, held_for_quiet_hours: held, quiet };
});
