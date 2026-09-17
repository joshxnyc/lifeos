import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromZonedTime } from "date-fns-tz";
import { MODEL_MAIN, callStructured, loadPrompt } from "@/lib/ai/client";
import { buildContext } from "@/lib/ai/context";
import { getSettings } from "@/lib/settings";
import { addDays, localDate } from "@/lib/time";
import { isFollowUpOverdue } from "@/lib/people";
import { assembleScorecardInput, computeScorecard } from "@/lib/domain/scorecard";
import { diffDays } from "@/lib/domain/dates";
import type {
  Capture,
  CalendarEvent,
  Domain,
  Person,
  Routine,
  RoutineLog,
  Scorecard,
  Suggestion,
  Task,
  WeeklyReview,
} from "@/lib/types";

// SPEC §7.4 / §7.5 — the coach read and the raw-row gathering behind the
// scorecard. The arithmetic itself lives in lib/domain/scorecard.ts (pure,
// unit-tested); everything here is I/O.

/**
 * Every raw row the scorecard needs for one Monday–Sunday week, in one place.
 * lib/domain/scorecard.ts owns the exact field names it consumes; if the shape
 * drifts, reconcile it here rather than spreading queries through the review.
 */
export interface ScorecardInputRaw {
  week_start: string;
  week_end: string;
  timezone: string;
  now: string;
  domains: Pick<Domain, "id" | "name" | "slug">[];
  tasks: Task[];
  suggestions: Suggestion[];
  routines: Routine[];
  routine_logs: RoutineLog[];
  captures: Capture[];
  calendar_events: CalendarEvent[];
  people_overdue_followup: number;
  previous_scorecards: Scorecard[];
}

function weekBounds(weekStart: string, tz: string): { startIso: string; endIso: string; weekEnd: string } {
  const weekEnd = addDays(weekStart, 6);
  return {
    startIso: fromZonedTime(`${weekStart}T00:00:00`, tz).toISOString(),
    endIso: fromZonedTime(`${addDays(weekEnd, 1)}T00:00:00`, tz).toISOString(),
    weekEnd,
  };
}

function mergeById<T extends { id: string }>(...lists: (T[] | null | undefined)[]): T[] {
  const map = new Map<string, T>();
  for (const list of lists ?? []) for (const row of list ?? []) map.set(row.id, row);
  return [...map.values()];
}

/** Assemble the raw rows for `computeScorecard` (SPEC §7.5). */
export async function gatherScorecardInput(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
): Promise<ScorecardInputRaw> {
  const settings = await getSettings(supabase, userId);
  const tz = settings.timezone;
  const { startIso, endIso, weekEnd } = weekBounds(weekStart, tz);

  const [
    { data: domains },
    { data: createdTasks },
    { data: completedTasks },
    { data: openTasks },
    { data: createdSuggestions },
    { data: resolvedSuggestions },
    { data: routines },
    { data: routineLogs },
    { data: captures },
    { data: events },
    { data: people },
    { data: prevReviews },
  ] = await Promise.all([
    supabase.from("domains").select("id, name, slug").eq("user_id", userId).order("sort_order"),
    supabase.from("tasks").select("*").eq("user_id", userId).gte("created_at", startIso).lt("created_at", endIso),
    supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .gte("completed_at", startIso)
      .lt("completed_at", endIso),
    supabase.from("tasks").select("*").eq("user_id", userId).eq("status", "open").limit(1000),
    supabase
      .from("suggestions")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    supabase
      .from("suggestions")
      .select("*")
      .eq("user_id", userId)
      .gte("resolved_at", startIso)
      .lt("resolved_at", endIso),
    supabase.from("routines").select("*").eq("user_id", userId).eq("active", true),
    supabase
      .from("routine_logs")
      .select("*")
      .eq("user_id", userId)
      .gte("date", addDays(weekStart, -28))
      .lte("date", weekEnd),
    supabase
      .from("captures")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    supabase
      .from("calendar_events")
      .select("*")
      .eq("user_id", userId)
      .gte("starts_at", startIso)
      .lt("starts_at", endIso),
    supabase
      .from("people")
      .select("id, follow_up_every_days, last_contact_at, created_at")
      .eq("user_id", userId)
      .not("follow_up_every_days", "is", null),
    supabase
      .from("weekly_reviews")
      .select("week_start, scorecard")
      .eq("user_id", userId)
      .lt("week_start", weekStart)
      .not("scorecard", "is", null)
      .order("week_start", { ascending: false })
      .limit(4),
  ]);

  const now = new Date();
  return {
    week_start: weekStart,
    week_end: weekEnd,
    timezone: tz,
    now: now.toISOString(),
    domains: (domains ?? []) as Pick<Domain, "id" | "name" | "slug">[],
    tasks: mergeById(createdTasks as Task[], completedTasks as Task[], openTasks as Task[]),
    suggestions: mergeById(createdSuggestions as Suggestion[], resolvedSuggestions as Suggestion[]),
    routines: (routines ?? []) as Routine[],
    routine_logs: (routineLogs ?? []) as RoutineLog[],
    captures: (captures ?? []) as Capture[],
    calendar_events: (events ?? []) as CalendarEvent[],
    people_overdue_followup: (
      (people ?? []) as Pick<Person, "id" | "follow_up_every_days" | "last_contact_at" | "created_at">[]
    ).filter((p) => isFollowUpOverdue(p, now)).length,
    previous_scorecards: ((prevReviews ?? []) as { scorecard: Scorecard }[]).map((r) => r.scorecard),
  };
}

/** Gather + compute in one call; used by review step 1 and by the coach. */
export async function buildScorecard(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
): Promise<Scorecard> {
  const input = await gatherScorecardInput(supabase, userId, weekStart);
  // ScorecardInputRaw structurally satisfies ScorecardRawRows, so the compiler
  // checks the bridge — the old `as unknown as` cast here shipped a shape
  // computeScorecard could not read and crashed every review at step 1.
  return computeScorecard(assembleScorecardInput(input));
}

// ---------------------------------------------------------------------------
// The coach read
// ---------------------------------------------------------------------------

export interface CoachOutput {
  read: string;
  one_change: string;
  pattern_flags: string[];
}

const COACH_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    read: { type: "string", description: "Markdown, 220 words or fewer. First sentence carries the headline number." },
    one_change: { type: "string", description: "One imperative, measurable sentence." },
    pattern_flags: {
      type: "array",
      items: { type: "string" },
      description: "Two to four lowercase_underscore tags.",
    },
  },
  required: ["read", "one_change", "pattern_flags"],
  additionalProperties: false,
};

/**
 * Run the coach for a week and store the result on the weekly_reviews row
 * (SPEC §7.4). Re-running replaces the previous read — that is what the
 * Regenerate link does.
 */
export async function runWeeklyCoach(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
): Promise<CoachOutput> {
  const settings = await getSettings(supabase, userId);

  const { data: reviewRow } = await supabase
    .from("weekly_reviews")
    .select("*")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .single();
  const review = reviewRow as WeeklyReview | null;
  if (!review) throw new Error("No review for that week.");

  const scorecard = review.scorecard ?? (await buildScorecard(supabase, userId, weekStart));

  const [{ data: prevReviews }, { data: logs }, { data: top3Tasks }] = await Promise.all([
    supabase
      .from("weekly_reviews")
      .select("week_start, scorecard, one_change, one_change_accepted")
      .eq("user_id", userId)
      .lt("week_start", weekStart)
      .not("scorecard", "is", null)
      .order("week_start", { ascending: false })
      .limit(4),
    supabase
      .from("routine_logs")
      .select("date, status, routine_id")
      .eq("user_id", userId)
      .gte("date", addDays(weekStart, -21))
      .lte("date", addDays(weekStart, 6)),
    review.week_top3?.length
      ? supabase.from("tasks").select("id, title").in("id", review.week_top3)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);

  // Under a week of data there is no pattern to read, and an LLM asked for one
  // anyway will invent it. Say so plainly, with the numbers, and skip the call.
  const history = (prevReviews ?? []) as {
    week_start: string;
    scorecard: Scorecard;
    one_change: string | null;
    one_change_accepted: boolean | null;
  }[];
  const today = localDate(new Date(), settings.timezone);
  if (history.length === 0) {
    const { data: firstDomain } = await supabase
      .from("domains")
      .select("created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const firstDay = firstDomain?.created_at
      ? localDate(new Date(firstDomain.created_at), settings.timezone)
      : today;
    const daysOfData = Math.max(1, diffDays(firstDay, today) + 1);
    if (daysOfData < 7) {
      const t = scorecard.total;
      const read = [
        `${daysOfData} ${daysOfData === 1 ? "day" : "days"} of data. Not enough for a read.`,
        "",
        `So far: ${t.completed} completed, ${t.created} created, ${t.open} open, ` +
          `${t.overdue_at_week_end} overdue. A pattern takes at least one full week of numbers ` +
          `and this is ${daysOfData === 1 ? "one day" : `${daysOfData} days`}. ` +
          `Keep capturing, log the routines, and the first real read comes with a full week behind it.`,
      ].join("\n");
      await supabase
        .from("weekly_reviews")
        .update({ coach_text: read, coach_model: null, one_change: null, scorecard })
        .eq("id", review.id);
      return { read, one_change: "", pattern_flags: ["insufficient_history"] };
    }
  }

  const { data: routines } = await supabase
    .from("routines")
    .select("id, name")
    .eq("user_id", userId);
  const routineName = new Map((routines ?? []).map((r) => [r.id as string, r.name as string]));

  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const byWeekday = new Map<string, { done: number; missed: number }>();
  for (const log of (logs ?? []) as Pick<RoutineLog, "date" | "status" | "routine_id">[]) {
    if (log.status === "skipped") continue;
    const day = weekdayNames[new Date(`${log.date}T12:00:00Z`).getUTCDay()]!;
    const key = `${routineName.get(log.routine_id) ?? "routine"} · ${day}`;
    const bucket = byWeekday.get(key) ?? { done: 0, missed: 0 };
    if (log.status === "done") bucket.done += 1;
    else bucket.missed += 1;
    byWeekday.set(key, bucket);
  }

  const context = await buildContext(supabase, userId, settings.timezone);
  const system = await loadPrompt("weekly-coach", { context });

  const weekEnd = addDays(weekStart, 6);
  const userContent = [
    `# Week of ${weekStart}`,
    ...(today < weekEnd
      ? [
          "",
          `Note: this review is being run on ${today}, before the week ends on ${weekEnd}. ` +
            "The numbers cover a partial week — read them as such and do not count unfinished days as failures.",
        ]
      : []),
    "",
    "## This week's scorecard",
    "```json",
    JSON.stringify(scorecard),
    "```",
    "",
    "## Previous four weeks",
    "```json",
    JSON.stringify(
      ((prevReviews ?? []) as { week_start: string; scorecard: Scorecard; one_change: string | null; one_change_accepted: boolean | null }[]).map(
        (r) => ({
          week_start: r.week_start,
          scorecard: r.scorecard,
          one_change: r.one_change,
          one_change_accepted: r.one_change_accepted,
        }),
      ),
    ),
    "```",
    "",
    "## Decisions he just made on slipped tasks",
    JSON.stringify(review.slipped_decisions ?? []),
    "",
    "## Decisions he just made on dormant projects and people",
    JSON.stringify(review.dormant_decisions ?? []),
    "",
    "## Top three he picked for next week",
    ((top3Tasks ?? []) as { title: string }[]).map((t) => `- ${t.title}`).join("\n") || "- none picked",
    "",
    "## Routine outcomes by weekday, last four weeks (skips excluded)",
    [...byWeekday.entries()].map(([key, v]) => `- ${key}: ${v.done} done, ${v.missed} missed`).join("\n") ||
      "- no routine logs",
  ].join("\n");

  const result = await callStructured<CoachOutput>({
    pipeline: "weeklyCoach",
    system,
    userContent,
    toolName: "write_coach_read",
    toolDescription: "Return the weekly read, the single change for next week, and the pattern flags.",
    schema: COACH_SCHEMA,
    maxTokens: 1500,
    supabase,
    userId,
    refId: review.id,
  });

  await supabase
    .from("weekly_reviews")
    .update({
      coach_text: result.read,
      coach_model: MODEL_MAIN,
      one_change: result.one_change,
      scorecard,
    })
    .eq("id", review.id);

  return result;
}
