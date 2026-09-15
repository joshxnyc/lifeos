import "server-only";
import { fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "@/lib/settings";
import { addDays, localDate } from "@/lib/time";
import type { NotificationKind } from "@/lib/types";

export interface EnqueueOptions {
  kind: NotificationKind;
  title: string;
  body: string;
  url: string;
  scheduledFor: Date;
  payload?: Record<string, unknown>;
  /** Collapse to at most one per local day for this kind+payload.routine_id. */
  dedupeDaily?: boolean;
}

/**
 * All pushes go through notifications rows sent by notifications-tick
 * (SPEC §8) so everything is visible, deduped and cancellable. The unique
 * index on (kind, scheduled_for, payload->>routine_id) prevents duplicates;
 * inserts that hit it are silently ignored.
 */
export async function enqueueNotification(
  supabase: SupabaseClient,
  userId: string,
  opts: EnqueueOptions,
): Promise<boolean> {
  if (opts.dedupeDaily) {
    // "Once a day" means Joshua's day, not UTC's: a 21:00 New York digest is
    // already tomorrow in UTC, which would let a second one through.
    const { dayStart, dayEnd } = await localDayBounds(supabase, userId, opts.scheduledFor);
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", opts.kind)
      .gte("scheduled_for", dayStart)
      .lt("scheduled_for", dayEnd)
      .filter("payload->>routine_id", "eq", String(opts.payload?.routine_id ?? ""))
      .limit(1);
    if (existing?.length) return false;
  }

  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    kind: opts.kind,
    scheduled_for: opts.scheduledFor.toISOString(),
    title: opts.title,
    body: opts.body,
    url: opts.url,
    payload: opts.payload ?? {},
  });
  if (error) {
    if (error.code === "23505") return false; // dedupe index hit
    throw new Error(`enqueueNotification: ${error.message}`);
  }
  return true;
}

/** The half-open UTC range covering the local calendar day `at` falls in. */
async function localDayBounds(
  supabase: SupabaseClient,
  userId: string,
  at: Date,
): Promise<{ dayStart: string; dayEnd: string }> {
  let timezone = "UTC";
  try {
    timezone = (await getSettings(supabase, userId)).timezone || "UTC";
  } catch {
    // settings unreadable: fall back to UTC days rather than losing the dedupe
  }
  try {
    const day = localDate(at, timezone);
    return {
      dayStart: fromZonedTime(`${day}T00:00:00`, timezone).toISOString(),
      dayEnd: fromZonedTime(`${addDays(day, 1)}T00:00:00`, timezone).toISOString(),
    };
  } catch {
    const start = new Date(at);
    start.setUTCHours(0, 0, 0, 0);
    return {
      dayStart: start.toISOString(),
      dayEnd: new Date(start.getTime() + 86_400_000).toISOString(),
    };
  }
}

/** "23:00"–"06:30" style window check in the user's local time (SPEC §8). */
export function isInQuietHours(
  localHHmm: string,
  quiet: { start: string; end: string },
): boolean {
  const t = localHHmm;
  if (quiet.start <= quiet.end) return t >= quiet.start && t < quiet.end;
  return t >= quiet.start || t < quiet.end; // crosses midnight
}
