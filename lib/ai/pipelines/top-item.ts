import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromZonedTime } from "date-fns-tz";
import { callStructured, DailyAiBudgetError, loadPrompt } from "@/lib/ai/client";
import { buildContext } from "@/lib/ai/context";
import { enqueueNotification } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { addDays, isDueNow, localDate, localTime, mondayOf } from "@/lib/time";
import { rankTasks } from "@/lib/domain/top-item";
import { isFollowUpOverdue } from "@/lib/people";
import type { CalendarEvent, Person, Routine, RoutineLog, Task } from "@/lib/types";

// SPEC §7.3 — heuristic first, LLM second. The heuristic (lib/domain/top-item)
// shortlists five candidates; the model picks one, names up to two runners-up
// and writes the one-line reason, given the day's calendar load.

interface TopItemOutput {
  top_task_id: string;
  runner_up_ids: string[];
  reason: string;
}

const TOP_ITEM_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    top_task_id: { type: "string", description: "Id of the chosen task, from the candidates." },
    runner_up_ids: {
      type: "array",
      items: { type: "string" },
      description: "At most two other candidate ids, best first.",
    },
    reason: { type: "string", description: "One sentence, 18 words or fewer, numbers not adjectives." },
  },
  required: ["top_task_id", "runner_up_ids", "reason"],
  additionalProperties: false,
};

function dayOfWeek(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Decide whether this 15-minute tick should plan the day: either we are in the
 * window after the planning time, or the day has no plan yet and it is still
 * morning (a missed tick, a cold deploy, a phone that woke up late).
 *
 * Planning normally runs at 06:30, half an hour before the default brief. If
 * the brief is set earlier than that, planning moves with it — otherwise the
 * plan would not exist when the brief is due and the brief would go out late.
 */
const PLANNING_TIME = "06:30";

export function planningTimeFor(morningBriefTime?: string | null): string {
  if (!morningBriefTime || !/^([01]\d|2[0-3]):[0-5]\d/.test(morningBriefTime)) return PLANNING_TIME;
  const brief = morningBriefTime.slice(0, 5);
  return brief < PLANNING_TIME ? brief : PLANNING_TIME;
}

export function shouldPlanNow(
  localHHmm: string,
  hasPlan: boolean,
  morningBriefTime?: string | null,
): boolean {
  const planningTime = planningTimeFor(morningBriefTime);
  if (isDueNow(localHHmm, planningTime)) return true;
  return !hasPlan && localHHmm >= planningTime && localHHmm < "12:00";
}

export async function planMorning(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
): Promise<Record<string, unknown>> {
  const settings = await getSettings(supabase, userId);
  const tz = settings.timezone;
  const today = localDate(now, tz);
  const timeNow = localTime(now, tz);

  const { data: existingPlan } = await supabase
    .from("daily_plans")
    .select("id, date, proposed_top_task_ids, chosen_top_task_id, brief_sent_at")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();

  if (!shouldPlanNow(timeNow, Boolean(existingPlan), settings.morning_brief_time)) {
    return { skipped: true, reason: "not the planning window", local_time: timeNow };
  }

  const stats: Record<string, unknown> = { date: today, used_llm: false, brief_enqueued: false };

  // ---- candidates -------------------------------------------------------
  const weekEnd = addDays(mondayOf(today), 6);
  const [{ data: openTasks }, { data: doneRecently }, { data: projects }, { data: people }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "open")
        .eq("is_mirror", false)
        .limit(500),
      supabase
        .from("tasks")
        .select("domain_id")
        .eq("user_id", userId)
        .eq("status", "done")
        .gte("completed_at", new Date(now.getTime() - 7 * 86_400_000).toISOString()),
      supabase.from("projects").select("id, target_date").eq("user_id", userId),
      supabase
        .from("people")
        .select("id, follow_up_every_days, last_contact_at, created_at")
        .eq("user_id", userId)
        .not("follow_up_every_days", "is", null),
    ]);

  const tasks = (openTasks ?? []) as Task[];
  const domainCompletions7d: Record<string, number> = {};
  for (const row of doneRecently ?? []) {
    const id = String(row.domain_id);
    domainCompletions7d[id] = (domainCompletions7d[id] ?? 0) + 1;
  }
  const projectTargetDates: Record<string, string | null> = {};
  for (const p of projects ?? []) projectTargetDates[p.id] = p.target_date ?? null;
  const overdueFollowUpPersonIds = new Set(
    ((people ?? []) as Pick<Person, "id" | "follow_up_every_days" | "last_contact_at" | "created_at">[])
      .filter((p) => isFollowUpOverdue(p, now))
      .map((p) => p.id),
  );

  const scoreCtx = { today, weekEnd, domainCompletions7d, overdueFollowUpPersonIds, projectTargetDates };
  const candidates = tasks.length ? rankTasks(tasks, scoreCtx).slice(0, 5) : [];

  // ---- today's calendar load -------------------------------------------
  const { data: eventRows } = await supabase
    .from("calendar_events")
    .select("id, title, starts_at, ends_at, all_day")
    .eq("user_id", userId)
    .gte("starts_at", new Date(now.getTime() - 36 * 3_600_000).toISOString())
    .lte("starts_at", new Date(now.getTime() + 36 * 3_600_000).toISOString());

  const todaysEvents = ((eventRows ?? []) as Pick<
    CalendarEvent,
    "id" | "title" | "starts_at" | "ends_at" | "all_day"
  >[])
    .filter((e) => localDate(new Date(e.starts_at), tz) === today && !e.all_day)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const meetingHours =
    Math.round(
      (todaysEvents.reduce(
        (sum, e) => sum + (new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime()),
        0,
      ) /
        3_600_000) *
        10,
    ) / 10;
  const firstMeeting = todaysEvents[0] ? localTime(new Date(todaysEvents[0].starts_at), tz) : null;

  // ---- proposal ---------------------------------------------------------
  let proposedIds: string[] = [];
  let reason: string | null = null;

  if (candidates.length === 1) {
    proposedIds = [candidates[0]!.id];
    reason = heuristicReason(candidates[0]!, today);
  } else if (candidates.length > 1) {
    const fallbackTop = candidates[0]!;
    try {
      const context = await buildContext(supabase, userId, tz);
      const system = await loadPrompt("propose-top-item", { context });
      const result = await callStructured<TopItemOutput>({
        pipeline: "proposeTopItem",
        system,
        userContent: buildUserContent(candidates, today, meetingHours, firstMeeting, todaysEvents.length),
        toolName: "pick_top_item",
        toolDescription: "Choose today's top item and up to two runners-up from the candidates.",
        schema: TOP_ITEM_SCHEMA,
        maxTokens: 500,
        supabase,
        userId,
      });

      const valid = new Set(candidates.map((t) => t.id));
      const top = valid.has(result.top_task_id) ? result.top_task_id : fallbackTop.id;
      const runners = (result.runner_up_ids ?? [])
        .filter((id) => valid.has(id) && id !== top)
        .slice(0, 2);
      proposedIds = [top, ...runners];
      reason = (result.reason ?? "").trim().slice(0, 200) || heuristicReason(fallbackTop, today);
      stats.used_llm = true;
    } catch (err) {
      proposedIds = candidates.slice(0, 3).map((t) => t.id);
      reason = heuristicReason(fallbackTop, today);
      // The heuristic proposal still lands either way; the stats just say why
      // the model sat this one out.
      if (err instanceof DailyAiBudgetError) stats.skipped = "daily budget";
      else stats.llm_failed = true;
    }
  }

  if (proposedIds.length) {
    await supabase.from("daily_plans").upsert(
      {
        user_id: userId,
        date: today,
        proposed_top_task_ids: proposedIds,
        proposal_reason: reason,
      },
      { onConflict: "user_id,date" },
    );
  } else {
    await supabase.from("daily_plans").upsert(
      { user_id: userId, date: today, proposed_top_task_ids: [], proposal_reason: null },
      { onConflict: "user_id,date" },
    );
  }
  stats.proposed = proposedIds.length;

  // ---- morning brief ----------------------------------------------------
  if (!existingPlan?.brief_sent_at) {
    const topTask =
      tasks.find((t) => t.id === (existingPlan?.chosen_top_task_id ?? proposedIds[0])) ?? null;
    const body = await buildBriefBody(supabase, userId, {
      now,
      tz,
      today,
      tasks,
      topTask,
      firstMeeting,
      meetingHours,
      meetingCount: todaysEvents.length,
    });

    const scheduledFor = scheduleAt(today, settings.morning_brief_time, tz, now);
    const enqueued = await enqueueNotification(supabase, userId, {
      kind: "morning_brief",
      title: "Morning brief",
      body,
      url: "/today",
      scheduledFor,
      payload: { routine_id: `morning_brief:${today}` },
    });
    if (enqueued) {
      await supabase
        .from("daily_plans")
        .update({ brief_sent_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("date", today);
      stats.brief_enqueued = true;
    }
  }

  return stats;
}

/** The configured local time today, or now if that moment has already passed. */
function scheduleAt(today: string, hhmm: string, tz: string, now: Date): Date {
  const at = fromZonedTime(`${today}T${hhmm.length === 5 ? hhmm : hhmm.slice(0, 5)}:00`, tz);
  return at.getTime() > now.getTime() ? at : now;
}

function heuristicReason(task: Task, today: string): string {
  if (task.due_date && task.due_date < today) {
    const days = Math.round(
      (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${task.due_date}T00:00:00Z`).getTime()) /
        86_400_000,
    );
    return `Highest score: overdue by ${plural(days, "day")}.`;
  }
  if (task.due_date === today) return "Highest score: due today.";
  if (task.scheduled_date === today) return "Highest score: you scheduled it for today.";
  if (task.priority === 3) return "Highest score: marked high priority.";
  return "Highest score of your open tasks.";
}

function buildUserContent(
  candidates: Task[],
  today: string,
  meetingHours: number,
  firstMeeting: string | null,
  meetingCount: number,
): string {
  const lines = [
    `Today is ${today}.`,
    "",
    "## Calendar today",
    meetingCount
      ? `${plural(meetingCount, "meeting")}, ${meetingHours}h booked, first at ${firstMeeting}.`
      : "Nothing on the calendar.",
    "",
    "## Candidates, best-scoring first",
  ];
  for (const t of candidates) {
    const bits = [
      t.due_date ? `due ${t.due_date}` : "no due date",
      t.scheduled_date === today ? "scheduled today" : "",
      t.priority ? `priority ${t.priority}` : "",
      t.owner === "them" ? "someone else owes this" : "",
    ].filter(Boolean);
    lines.push(`- id: ${t.id} — ${t.title} (${bits.join(", ")})`);
  }
  return lines.join("\n");
}

async function buildBriefBody(
  supabase: SupabaseClient,
  userId: string,
  args: {
    now: Date;
    tz: string;
    today: string;
    tasks: Task[];
    topTask: Task | null;
    firstMeeting: string | null;
    meetingHours: number;
    meetingCount: number;
  },
): Promise<string> {
  const { today, tasks, topTask, firstMeeting, meetingHours, meetingCount } = args;

  const [{ count: pendingCount }, { data: routines }, { data: yesterdayLogs }] = await Promise.all([
    supabase
      .from("suggestions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending"),
    supabase.from("routines").select("id, name, schedule_days").eq("user_id", userId).eq("active", true),
    supabase
      .from("routine_logs")
      .select("routine_id, status")
      .eq("user_id", userId)
      .eq("date", addDays(today, -1)),
  ]);

  const dueToday = tasks.filter((t) => t.due_date === today).length;
  const sentences: string[] = [];

  if (topTask) {
    sentences.push(`Top item: ${topTask.title}.`);
  } else if (!tasks.length) {
    sentences.push("Nothing open.");
  }

  const calendarBit = meetingCount
    ? `first meeting ${firstMeeting}, ${meetingHours}h booked`
    : "nothing on the calendar";
  sentences.push(`${dueToday} due today, ${calendarBit}.`);

  if (pendingCount) sentences.push(`${plural(pendingCount, "suggestion")} waiting.`);

  const todayDow = dayOfWeek(today);
  const yesterdayDow = dayOfWeek(addDays(today, -1));
  const routineRows = ((routines ?? []) as Pick<Routine, "id" | "name" | "schedule_days">[]) ?? [];
  const todays = routineRows.filter((r) => r.schedule_days.includes(todayDow));
  if (todays.length) sentences.push(`Routines: ${todays.map((r) => r.name).join(", ")}.`);

  const logs = (yesterdayLogs ?? []) as Pick<RoutineLog, "routine_id" | "status">[];
  const atRisk = routineRows
    .filter((r) => r.schedule_days.includes(yesterdayDow))
    .filter((r) => {
      const log = logs.find((l) => l.routine_id === r.id);
      return !log || log.status === "missed";
    });
  if (atRisk.length) {
    sentences.push(
      `${atRisk.map((r) => r.name).join(", ")} ${atRisk.length === 1 ? "streak is" : "streaks are"} at risk after yesterday.`,
    );
  }

  return sentences.join(" ").slice(0, 400);
}
