import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
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
    const dayStart = new Date(opts.scheduledFor);
    dayStart.setUTCHours(0, 0, 0, 0);
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", opts.kind)
      .gte("scheduled_for", dayStart.toISOString())
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

/** "23:00"–"06:30" style window check in the user's local time (SPEC §8). */
export function isInQuietHours(
  localHHmm: string,
  quiet: { start: string; end: string },
): boolean {
  const t = localHHmm;
  if (quiet.start <= quiet.end) return t >= quiet.start && t < quiet.end;
  return t >= quiet.start || t < quiet.end; // crosses midnight
}
