import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import type { NotificationKind, NotificationRow, NotificationStatus } from "@/lib/types";

// Self-contained so Settings (A4) can drop it in with <NotificationHistory />.
// SPEC §10 Phase 2: "notification history in Settings".

const KIND_LABEL: Record<NotificationKind, string> = {
  morning_brief: "Morning brief",
  routine_reminder: "Routine",
  routine_missed: "Nudge",
  evening_closeout: "Close-out",
  review_prompt: "Weekly review",
  queue_digest: "Queue",
  follow_up_due: "Follow-up",
  needs_reauth: "Account",
  sync_failed: "Job",
  custom: "Custom",
  test: "Test",
};

const STATUS_CLASS: Record<NotificationStatus, string> = {
  sent: "text-ok",
  scheduled: "text-ink-2",
  cancelled: "text-ink-2",
  failed: "text-danger",
};

export async function NotificationHistory({ limit = 30 }: { limit?: number }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data }, settings] = await Promise.all([
    supabase
      .from("notifications")
      .select("*")
      .order("scheduled_for", { ascending: false })
      .limit(limit),
    getSettings(supabase, user.id),
  ]);

  const rows = (data ?? []) as NotificationRow[];
  if (rows.length === 0) {
    return <p className="py-4 text-[14px] text-ink-2">No notifications yet.</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {rows.map((n) => {
        const when = n.sent_at ?? n.scheduled_for;
        return (
          <li key={n.id} className="flex items-baseline gap-3 py-2.5">
            <span className="w-24 shrink-0 text-[12px] text-ink-2">{KIND_LABEL[n.kind]}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] text-ink">{n.title}</span>
              {n.body ? (
                <span className="block truncate text-[12px] text-ink-2">{n.body}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-right">
              <span className={cn("block text-[12px]", STATUS_CLASS[n.status])}>{n.status}</span>
              <span className="tabular block font-mono text-[11px] text-ink-2">
                {formatInTimeZone(new Date(when), settings.timezone, "d MMM HH:mm")}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
