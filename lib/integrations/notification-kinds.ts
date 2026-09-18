import type { NotificationKind } from "@/lib/types";

/**
 * The push kinds Joshua can switch off individually in Settings →
 * Notifications (SPEC §8 matrix). Stored as settings key
 * `notification_kind_toggles`; a missing key means on. notifications-tick is
 * the only sender and checks the map before sending.
 */
export const NOTIFICATION_KINDS: NotificationKind[] = [
  "morning_brief",
  "routine_reminder",
  "routine_missed",
  "evening_closeout",
  "review_prompt",
  "queue_digest",
  "follow_up_due",
  "task_due",
  "needs_reauth",
  "sync_failed",
];

export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  morning_brief: "Morning brief",
  routine_reminder: "Routine reminders",
  routine_missed: "Missed routine nudges",
  evening_closeout: "Evening close-out",
  review_prompt: "Weekly review prompt",
  queue_digest: "Queue digest",
  follow_up_due: "Follow-up due",
  task_due: "Task deadlines",
  needs_reauth: "Account needs reconnecting",
  sync_failed: "Sync failures",
};

export type NotificationToggles = Partial<Record<NotificationKind, boolean>>;
