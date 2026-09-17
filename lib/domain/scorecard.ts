// Weekly scorecard (SPEC §7.5) — pure, no LLM. Step 1 of the weekly review
// shows it and the coach read (§7.4) is written from it, so every number here
// has to be defensible: this is the "honest feedback with numbers" the app
// exists for.
//
// The caller passes raw rows for one Monday–Sunday week and the previous four
// weeks' headline numbers; nothing in here reads the clock or the database.
// Timestamps (created_at, completed_at, …) are `timestamptz` and are bucketed
// into local calendar days with `input.timezone`.

import type {
  Capture,
  RoutineLog,
  Scorecard,
  SuggestionStatus,
  TaskOrigin,
  TaskStatus,
} from "@/lib/types";
import { addDays, localDate } from "@/lib/time";
import { dayOfWeekOf, eachDate } from "@/lib/domain/dates";
import { computeStreaks } from "@/lib/domain/streaks";

export interface ScorecardTaskRow {
  domain_id: string;
  status: TaskStatus;
  origin: TaskOrigin;
  created_at: string;
  /** When a dropped task was dropped — tasks carry no dropped_at column. */
  updated_at: string;
  completed_at: string | null;
  due_date: string | null;
}

export interface ScorecardSuggestionRow {
  created_at: string;
  status: SuggestionStatus;
  resolved_at: string | null;
}

export interface ScorecardRoutineRow {
  id: string;
  name: string;
  schedule_days: number[];
  /** Logs covering at least this week; pass full history for true best streaks. */
  logs: Pick<RoutineLog, "date" | "status">[];
}

export type ScorecardCaptureRow = Pick<Capture, "created_at" | "result">;

export interface ScorecardEventRow {
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  domain_id: string | null;
  status?: string;
}

/** Headline numbers of an earlier week — see `summarizeScorecard`. */
export interface PreviousWeekSummary {
  week_start: string;
  completed: number;
  on_time_rate: number | null;
  adherence: number | null;
}

export interface ScorecardInput {
  /** Monday, YYYY-MM-DD. */
  week_start: string;
  /** Sunday; defaults to week_start + 6. */
  week_end?: string;
  /** Date the card is computed on, for current streaks. Defaults to week_end. */
  as_of?: string;
  timezone: string;
  /** Every domain that should appear, including ones with no activity. */
  domain_ids: string[];
  /** Tasks that could touch this week: created, completed, dropped or still open. */
  tasks: ScorecardTaskRow[];
  suggestions: ScorecardSuggestionRow[];
  routines: ScorecardRoutineRow[];
  captures: ScorecardCaptureRow[];
  calendar_events: ScorecardEventRow[];
  /** People past their follow_up_every_days cadence at week end. */
  people_overdue_followup: number;
  /** Up to four earlier weeks, any order. */
  previous_weeks: PreviousWeekSummary[];
}

/** Meeting-hours bucket for events on a calendar with no domain mapping. */
export const UNASSIGNED_DOMAIN_KEY = "unassigned";

type DomainCounts = Scorecard["total"];

function emptyCounts(): DomainCounts {
  return { created: 0, completed: 0, dropped: 0, open: 0, overdue_at_week_end: 0 };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lo = sorted[mid - 1] ?? 0;
  const hi = sorted[mid] ?? 0;
  return (lo + hi) / 2;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function average(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!present.length) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

/** Rebuild the headline numbers of a stored scorecard, for `previous_weeks`. */
export function summarizeScorecard(scorecard: Scorecard): PreviousWeekSummary {
  const { on_time, late, still_open } = scorecard.commitments;
  const commitments = on_time + late + still_open;
  const scheduled = scorecard.routines.reduce((sum, r) => sum + r.scheduled - r.skipped, 0);
  const done = scorecard.routines.reduce((sum, r) => sum + r.done, 0);
  return {
    week_start: scorecard.week_start,
    completed: scorecard.total.completed,
    on_time_rate: commitments === 0 ? null : round(on_time / commitments, 4),
    adherence: scheduled === 0 ? null : round(done / scheduled, 4),
  };
}

/**
 * Rows as the queries hand them over, before they fit `ScorecardInput`:
 * routine logs in one flat list, whole previous scorecards instead of
 * summaries, a timestamp instead of an as_of date. `assembleScorecardInput`
 * is the one typed bridge between the two shapes — never cast across them.
 */
export interface ScorecardRawRows {
  week_start: string;
  week_end?: string;
  timezone: string;
  /** ISO timestamp the card is computed at; becomes as_of, clamped into the week. */
  now: string;
  domains: { id: string }[];
  tasks: ScorecardTaskRow[];
  suggestions: ScorecardSuggestionRow[];
  routines: { id: string; name: string; schedule_days: number[] }[];
  routine_logs: (Pick<RoutineLog, "date" | "status"> & { routine_id: string })[];
  captures: ScorecardCaptureRow[];
  /** Calendar rows carry no domain mapping yet; those hours land in `unassigned`. */
  calendar_events: (Omit<ScorecardEventRow, "domain_id"> & { domain_id?: string | null })[];
  people_overdue_followup: number;
  previous_scorecards: Scorecard[];
}

/** Turn raw rows into `ScorecardInput`. Pure; safe on completely empty data. */
export function assembleScorecardInput(raw: ScorecardRawRows): ScorecardInput {
  const weekEnd = raw.week_end ?? addDays(raw.week_start, 6);
  const today = localDate(new Date(raw.now), raw.timezone);
  const asOf = today < raw.week_start ? raw.week_start : today > weekEnd ? weekEnd : today;

  const logsByRoutine = new Map<string, Pick<RoutineLog, "date" | "status">[]>();
  for (const log of raw.routine_logs ?? []) {
    const entry = { date: log.date, status: log.status };
    const list = logsByRoutine.get(log.routine_id);
    if (list) list.push(entry);
    else logsByRoutine.set(log.routine_id, [entry]);
  }

  return {
    week_start: raw.week_start,
    week_end: weekEnd,
    as_of: asOf,
    timezone: raw.timezone,
    domain_ids: (raw.domains ?? []).map((d) => d.id),
    tasks: raw.tasks ?? [],
    suggestions: raw.suggestions ?? [],
    routines: (raw.routines ?? []).map((routine) => ({
      id: routine.id,
      name: routine.name,
      schedule_days: routine.schedule_days,
      logs: logsByRoutine.get(routine.id) ?? [],
    })),
    captures: raw.captures ?? [],
    calendar_events: (raw.calendar_events ?? []).map((event) => ({
      ...event,
      domain_id: event.domain_id ?? null,
    })),
    people_overdue_followup: raw.people_overdue_followup ?? 0,
    previous_weeks: (raw.previous_scorecards ?? []).map(summarizeScorecard),
  };
}

export function computeScorecard(input: ScorecardInput): Scorecard {
  const weekStart = input.week_start;
  const weekEnd = input.week_end ?? addDays(weekStart, 6);
  const asOf = input.as_of ?? weekEnd;
  const tz = input.timezone;
  const day = (iso: string | null): string | null => (iso ? localDate(new Date(iso), tz) : null);
  const inWeek = (date: string | null): boolean => date !== null && date >= weekStart && date <= weekEnd;

  // ---- tasks, per domain and total -------------------------------------
  const domains: Record<string, DomainCounts> = {};
  for (const id of input.domain_ids) domains[id] = emptyCounts();
  const bucket = (domainId: string): DomainCounts => {
    const existing = domains[domainId];
    if (existing) return existing;
    const fresh = emptyCounts();
    domains[domainId] = fresh;
    return fresh;
  };

  for (const task of input.tasks) {
    const counts = bucket(task.domain_id);
    if (inWeek(day(task.created_at))) counts.created++;
    if (task.status === "done" && inWeek(day(task.completed_at))) counts.completed++;
    if (task.status === "dropped" && inWeek(day(task.updated_at))) counts.dropped++;
    // "at week end" is approximated from the task's current state: the card is
    // computed at or just after the end of the week it describes.
    if (task.status === "open" && (day(task.created_at) ?? weekStart) <= weekEnd) {
      counts.open++;
      if (task.due_date && task.due_date <= weekEnd) counts.overdue_at_week_end++;
    }
  }

  const total = emptyCounts();
  for (const counts of Object.values(domains)) {
    total.created += counts.created;
    total.completed += counts.completed;
    total.dropped += counts.dropped;
    total.open += counts.open;
    total.overdue_at_week_end += counts.overdue_at_week_end;
  }

  // ---- commitments: suggestion-born tasks due this week -----------------
  const commitments = { on_time: 0, late: 0, still_open: 0 };
  for (const task of input.tasks) {
    if (task.origin !== "suggestion" || !task.due_date) continue;
    if (task.due_date < weekStart || task.due_date > weekEnd) continue;
    if (task.status === "done") {
      const completed = day(task.completed_at);
      if (completed && completed > task.due_date) commitments.late++;
      else commitments.on_time++;
    } else if (task.status === "open") {
      commitments.still_open++;
    }
  }

  // ---- routines ---------------------------------------------------------
  // Only days up to as_of count, so a card computed mid-week does not book
  // Thursday as missed on Wednesday. As_of itself with no log is still
  // pending — same rule as streaks and completionRate.
  const weekDays = eachDate(weekStart, weekEnd);
  const routines: Scorecard["routines"] = input.routines.map((routine) => {
    const scheduledDays = new Set(routine.schedule_days);
    const byDate = new Map(routine.logs.map((log) => [log.date, log.status]));
    let scheduled = 0;
    let done = 0;
    let skipped = 0;
    let missed = 0;
    for (const date of weekDays) {
      if (!scheduledDays.has(dayOfWeekOf(date))) continue;
      if (date > asOf) continue; // not reached yet
      const status = byDate.get(date);
      if (!status && date === asOf) continue; // today, still pending
      scheduled++;
      if (status === "done") done++;
      else if (status === "skipped") skipped++;
      else missed++; // explicit missed, or a past day the nightly job has not written yet
    }
    const denominator = scheduled - skipped;
    const streaks = computeStreaks(routine.logs, routine.schedule_days, asOf);
    return {
      routine_id: routine.id,
      name: routine.name,
      scheduled,
      done,
      skipped,
      missed,
      adherence: denominator === 0 ? 0 : round(done / denominator, 4),
      current_streak: streaks.current,
      best_streak: streaks.best,
    };
  });

  // ---- queue ------------------------------------------------------------
  let received = 0;
  let accepted = 0;
  let dismissed = 0;
  let pending = 0;
  const resolveHours: number[] = [];
  for (const suggestion of input.suggestions) {
    const created = day(suggestion.created_at);
    const resolved = day(suggestion.resolved_at);
    if (inWeek(created)) received++;
    if (suggestion.status === "accepted" && inWeek(resolved)) accepted++;
    if (suggestion.status === "dismissed" && inWeek(resolved)) dismissed++;
    // Pending at week end: it existed by Sunday and was not resolved by then.
    if (created !== null && created <= weekEnd && !(resolved !== null && resolved <= weekEnd)) pending++;
    if (inWeek(resolved) && suggestion.resolved_at) {
      const ms = Date.parse(suggestion.resolved_at) - Date.parse(suggestion.created_at);
      if (Number.isFinite(ms) && ms >= 0) resolveHours.push(ms / 3_600_000);
    }
  }
  const medianHours = median(resolveHours);

  // ---- captures ---------------------------------------------------------
  let captureCount = 0;
  let neededClarification = 0;
  for (const capture of input.captures) {
    if (!inWeek(day(capture.created_at))) continue;
    captureCount++;
    if (capture.result?.needs_clarification) neededClarification++;
  }

  // ---- meeting hours ----------------------------------------------------
  const meetingHours: Record<string, number> = {};
  for (const event of input.calendar_events) {
    if (event.all_day || event.status === "cancelled") continue;
    if (!inWeek(day(event.starts_at))) continue;
    const ms = Date.parse(event.ends_at) - Date.parse(event.starts_at);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    const key = event.domain_id ?? UNASSIGNED_DOMAIN_KEY;
    meetingHours[key] = (meetingHours[key] ?? 0) + ms / 3_600_000;
  }
  for (const key of Object.keys(meetingHours)) {
    meetingHours[key] = round(meetingHours[key] ?? 0, 2);
  }

  // ---- deltas -----------------------------------------------------------
  const previous = [...input.previous_weeks]
    .filter((week) => week.week_start < weekStart)
    .sort((a, b) => (a.week_start < b.week_start ? 1 : -1))
    .slice(0, 4);

  const commitmentTotal = commitments.on_time + commitments.late + commitments.still_open;
  const onTimeRate = commitmentTotal === 0 ? null : round(commitments.on_time / commitmentTotal, 4);
  const routineDenominator = routines.reduce((sum, r) => sum + r.scheduled - r.skipped, 0);
  const routineDone = routines.reduce((sum, r) => sum + r.done, 0);
  const adherence = routineDenominator === 0 ? null : round(routineDone / routineDenominator, 4);

  const avgCompleted = average(previous.map((w) => w.completed));
  const avgOnTime = average(previous.map((w) => w.on_time_rate));
  const avgAdherence = average(previous.map((w) => w.adherence));

  return {
    week_start: weekStart,
    domains,
    total,
    commitments,
    routines,
    queue: {
      received,
      accepted,
      dismissed,
      pending_at_week_end: pending,
      median_hours_to_resolve: medianHours === null ? null : round(medianHours, 1),
    },
    captures: { count: captureCount, needed_clarification: neededClarification },
    meeting_hours_by_domain: meetingHours,
    people_overdue_followup: input.people_overdue_followup,
    deltas: {
      vs_prev_weeks: previous.map((week) => ({
        week_start: week.week_start,
        completed: week.completed,
        on_time_rate: week.on_time_rate,
        adherence: week.adherence,
      })),
      vs_4wk_avg: {
        completed: avgCompleted === null ? null : round(total.completed - avgCompleted, 2),
        on_time_rate: avgOnTime === null || onTimeRate === null ? null : round(onTimeRate - avgOnTime, 4),
        adherence: avgAdherence === null || adherence === null ? null : round(adherence - avgAdherence, 4),
      },
    },
  };
}
