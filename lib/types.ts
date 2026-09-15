// Hand-maintained row types matching /supabase/migrations. Keep in sync with
// the schema; QA checks these against the SQL.

export type DomainSlug = "personal" | "almedia" | "tarifa" | "misc";
export type TaskStatus = "open" | "done" | "dropped";
export type TaskOwner = "me" | "them";
export type TaskOrigin = "manual" | "capture" | "suggestion" | "notion_mirror";
export type ProjectKind = "project" | "area";
export type ProjectStatus = "active" | "parked" | "done";
export type RoutineLogStatus = "done" | "missed" | "skipped";
export type CaptureStatus = "pending" | "transcribing" | "filing" | "done" | "failed";
export type CaptureSource = "phone_voice" | "phone_text" | "desktop_text" | "desktop_voice";
export type SuggestionKind = "task" | "deadline_change" | "follow_up" | "person_fact" | "project_update";
export type SuggestionStatus = "pending" | "accepted" | "dismissed" | "expired";
export type Provider = "google" | "notion" | "granola";
export type SourceKind = "email_thread" | "calendar_event" | "notion_page" | "granola_note";
export type ExtractionStatus = "pending" | "done" | "skipped" | "failed";
export type AccountStatus = "active" | "needs_reauth" | "disabled";
export type NotificationKind =
  | "morning_brief" | "routine_reminder" | "routine_missed" | "evening_closeout"
  | "review_prompt" | "queue_digest" | "follow_up_due" | "needs_reauth"
  | "sync_failed" | "custom" | "test";
export type NotificationStatus = "scheduled" | "sent" | "failed" | "cancelled";

interface Base {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface Domain extends Base {
  name: string;
  slug: DomainSlug;
  color: string;
  sort_order: number;
  is_placeholder: boolean;
}

export interface Project extends Base {
  domain_id: string;
  kind: ProjectKind;
  name: string;
  description: string | null;
  status: ProjectStatus;
  target_date: string | null;
  last_activity_at: string;
  notion_url: string | null;
  sort_order: number;
}

export interface Task extends Base {
  domain_id: string;
  project_id: string | null;
  person_id: string | null;
  title: string;
  body_md: string | null;
  status: TaskStatus;
  priority: 0 | 1 | 2 | 3;
  due_date: string | null;
  due_time: string | null;
  scheduled_date: string | null;
  completed_at: string | null;
  dropped_reason: string | null;
  recurrence_rule: string | null;
  owner: TaskOwner;
  origin: TaskOrigin;
  origin_id: string | null;
  source_item_id: string | null;
  calendar_event_id: string | null;
  is_mirror: boolean;
  sort_order: number;
}

export interface Routine extends Base {
  domain_id: string | null;
  name: string;
  emoji: string | null;
  schedule_days: number[];
  reminder_time: string | null;
  grace_minutes: number;
  nudge_enabled: boolean;
  active: boolean;
  write_to_calendar: boolean;
  calendar_event_external_id: string | null;
  sort_order: number;
}

export interface RoutineLog extends Base {
  routine_id: string;
  date: string;
  status: RoutineLogStatus;
  completed_at: string | null;
}

export interface Capture extends Base {
  raw_text: string | null;
  audio_path: string | null;
  transcript: string | null;
  cleaned_text: string | null;
  status: CaptureStatus;
  result: CaptureResult | null;
  error: string | null;
  source: CaptureSource;
}

export interface CaptureResult {
  items: Array<{
    type: "task" | "note" | "routine_log" | "person_update" | "reminder";
    id?: string;
    title?: string;
    detail?: string;
  }>;
  needs_clarification?: string;
}

export interface Suggestion extends Base {
  kind: SuggestionKind;
  title: string;
  detail: string | null;
  proposed: SuggestionProposed;
  evidence: string | null;
  source_item_id: string | null;
  confidence: number;
  status: SuggestionStatus;
  resolved_at: string | null;
  resulting_task_id: string | null;
  dedupe_key: string;
}

export interface SuggestionProposed {
  domain_id?: string;
  project_id?: string;
  person_id?: string;
  due_date?: string;
  priority?: number;
  existing_task_id?: string;
  owner?: TaskOwner;
  new_person?: { name: string; company?: string; role?: string };
  fact?: string;
  status?: ProjectStatus;
  target_date?: string;
}

export interface DailyPlan extends Base {
  date: string;
  proposed_top_task_ids: string[];
  proposal_reason: string | null;
  chosen_top_task_id: string | null;
  top3_task_ids: string[] | null;
  brief_sent_at: string | null;
  closeout_sent_at: string | null;
}

export interface Note extends Base {
  title: string;
  body_md: string;
  domain_id: string | null;
  project_id: string | null;
  person_id: string | null;
  pinned: boolean;
}

export interface Person extends Base {
  name: string;
  emails: string[];
  phone: string | null;
  company: string | null;
  role: string | null;
  domain_id: string | null;
  relationship: string | null;
  notes_md: string | null;
  last_contact_at: string | null;
  follow_up_every_days: number | null;
  next_follow_up_at: string | null;
  tags: string[];
}

export interface PersonSourceItem extends Base {
  person_id: string;
  source_item_id: string;
  role: "from" | "to" | "cc" | "attendee" | "mentioned";
}

export interface ConnectedAccount extends Base {
  provider: Provider;
  label: string;
  external_identity: string;
  default_domain_id: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  scopes: string[];
  sync_state: Record<string, unknown>;
  writable_calendar_id: string | null;
  read_calendar_ids: string[];
  status: AccountStatus;
  last_synced_at: string | null;
  last_error: string | null;
}

export interface SourceItem extends Base {
  account_id: string | null;
  provider: string;
  kind: SourceKind;
  external_id: string;
  external_url: string | null;
  title: string;
  text: string;
  raw: unknown;
  participants: Array<{ name?: string; email?: string; role?: string }>;
  occurred_at: string | null;
  fetched_at: string;
  content_hash: string;
  extraction_status: ExtractionStatus;
  extracted_at: string | null;
  domain_id: string | null;
}

export interface CalendarEvent extends Base {
  account_id: string;
  calendar_id: string;
  external_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  attendees: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  location: string | null;
  html_link: string | null;
  task_id: string | null;
  routine_id: string | null;
  created_by_app: boolean;
  source_item_id: string | null;
  status: string;
}

export interface PushSubscriptionRow extends Base {
  endpoint: string;
  p256dh: string;
  auth: string;
  device_label: string | null;
  last_used_at: string | null;
  failed_count: number;
}

export interface NotificationRow extends Base {
  kind: NotificationKind;
  scheduled_for: string;
  sent_at: string | null;
  title: string;
  body: string;
  url: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
}

export interface WeeklyReview extends Base {
  week_start: string;
  status: "in_progress" | "done";
  step_reached: 1 | 2 | 3 | 4 | 5;
  scorecard: Scorecard | null;
  slipped_decisions: SlippedDecision[];
  dormant_decisions: DormantDecision[];
  week_top3: string[] | null;
  coach_text: string | null;
  coach_model: string | null;
  one_change: string | null;
  one_change_accepted: boolean | null;
  completed_at: string | null;
}

export interface SlippedDecision {
  task_id: string;
  decision: "reschedule" | "drop" | "delegate";
  new_due?: string;
  note?: string;
  delegate_person_id?: string;
}

export interface DormantDecision {
  project_id?: string;
  person_id?: string;
  decision: "revive" | "park" | "close";
  next_action?: string;
}

/** SPEC §7.5 — computed by lib/domain/scorecard.ts, stored as jsonb. */
export interface Scorecard {
  week_start: string;
  domains: Record<
    string,
    { created: number; completed: number; dropped: number; open: number; overdue_at_week_end: number }
  >;
  total: { created: number; completed: number; dropped: number; open: number; overdue_at_week_end: number };
  commitments: { on_time: number; late: number; still_open: number };
  routines: Array<{
    routine_id: string;
    name: string;
    scheduled: number;
    done: number;
    skipped: number;
    missed: number;
    adherence: number;
    current_streak: number;
    best_streak: number;
  }>;
  queue: { received: number; accepted: number; dismissed: number; pending_at_week_end: number; median_hours_to_resolve: number | null };
  captures: { count: number; needed_clarification: number };
  meeting_hours_by_domain: Record<string, number>;
  people_overdue_followup: number;
  deltas: {
    vs_prev_weeks: Array<{ week_start: string; completed: number; on_time_rate: number | null; adherence: number | null }>;
    vs_4wk_avg: { completed: number | null; on_time_rate: number | null; adherence: number | null };
  };
}

export interface JobRun extends Omit<Base, "user_id"> {
  user_id: string | null;
  job: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "failed";
  stats: Record<string, unknown>;
  error: string | null;
}

export interface AiCall extends Omit<Base, "user_id"> {
  user_id: string | null;
  pipeline: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  cost_estimate_usd: number;
  ref_id: string | null;
}

/** settings keys with their value types (SPEC §4.5). */
export interface Settings {
  timezone: string;
  morning_brief_time: string;
  evening_closeout_time: string;
  weekly_review_day: number; // 0 = Sunday
  weekly_review_time: string;
  theme: "system" | "light" | "dark";
  quiet_hours: { start: string; end: string };
  extraction_interval_minutes: number;
  extraction_lookback_days_initial: number;
  dormancy_days: number;
  queue_digest_enabled: boolean;
  pushover_enabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  timezone: "America/New_York",
  morning_brief_time: "07:00",
  evening_closeout_time: "21:00",
  weekly_review_day: 0,
  weekly_review_time: "17:00",
  theme: "system",
  quiet_hours: { start: "23:00", end: "06:30" },
  extraction_interval_minutes: 60,
  extraction_lookback_days_initial: 30,
  dormancy_days: 14,
  queue_digest_enabled: true,
  pushover_enabled: false,
};
