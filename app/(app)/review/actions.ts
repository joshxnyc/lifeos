"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { localDate, mondayOf } from "@/lib/time";
import { buildScorecard, runWeeklyCoach } from "@/lib/ai/pipelines/coach";
import { acceptSuggestion } from "@/app/(app)/queue/actions";
import type { DormantDecision, SlippedDecision, WeeklyReview } from "@/lib/types";

// The five-step weekly review (SPEC §7.4–7.5, DESIGN_BRIEF §5.9). Every
// decision is applied to the underlying row immediately and appended to the
// review row, so an interrupted review never loses work.

const weekSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function session(): Promise<{ supabase: SupabaseClient; userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

async function getReview(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
): Promise<WeeklyReview> {
  const { data } = await supabase
    .from("weekly_reviews")
    .select("*")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (data) return data as WeeklyReview;

  const { data: created, error } = await supabase
    .from("weekly_reviews")
    .insert({ user_id: userId, week_start: weekStart })
    .select("*")
    .single();
  if (error) throw new Error(`review: ${error.message}`);
  return created as WeeklyReview;
}

/** Start or continue the review for a week and land on the furthest step reached. */
export async function openReview(weekStart?: string): Promise<void> {
  const { supabase, userId } = await session();
  const settings = await getSettings(supabase, userId);
  const week = weekSchema.parse(weekStart ?? mondayOf(localDate(new Date(), settings.timezone)));
  const review = await getReview(supabase, userId, week);
  redirect(`/review/${week}/${review.status === "done" ? 5 : review.step_reached}`);
}

async function advance(
  supabase: SupabaseClient,
  userId: string,
  weekStart: string,
  step: number,
): Promise<void> {
  const { data } = await supabase
    .from("weekly_reviews")
    .select("step_reached")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  const reached = Math.max(Number(data?.step_reached ?? 1), step);
  await supabase
    .from("weekly_reviews")
    .update({ step_reached: Math.min(5, reached) })
    .eq("user_id", userId)
    .eq("week_start", weekStart);
}

/** Step 1 → 2: freeze this week's numbers onto the review row. */
export async function commitScorecard(weekStart: string): Promise<void> {
  const { supabase, userId } = await session();
  const week = weekSchema.parse(weekStart);
  await getReview(supabase, userId, week);
  const scorecard = await buildScorecard(supabase, userId, week);
  await supabase
    .from("weekly_reviews")
    .update({ scorecard })
    .eq("user_id", userId)
    .eq("week_start", week);
  await advance(supabase, userId, week, 2);
  revalidatePath(`/review/${week}/2`);
  redirect(`/review/${week}/2`);
}

const slippedSchema = z.object({
  task_id: z.string().uuid(),
  decision: z.enum(["reschedule", "drop", "delegate"]),
  new_due: dateSchema.optional(),
  note: z.string().trim().max(300).optional(),
  delegate_person_id: z.string().uuid().optional(),
});

/** Step 2: a forced decision per overdue task, applied to the task immediately. */
export async function recordSlippedDecision(
  weekStart: string,
  input: SlippedDecision,
): Promise<void> {
  const { supabase, userId } = await session();
  const week = weekSchema.parse(weekStart);
  const decision = slippedSchema.parse(input);

  if (decision.decision === "reschedule") {
    if (!decision.new_due) throw new Error("Pick a new date.");
    await supabase
      .from("tasks")
      .update({ due_date: decision.new_due, scheduled_date: null })
      .eq("id", decision.task_id);
  } else if (decision.decision === "drop") {
    if (!decision.note) throw new Error("A one-line reason is required.");
    await supabase
      .from("tasks")
      .update({ status: "dropped", dropped_reason: decision.note })
      .eq("id", decision.task_id);
  } else {
    if (!decision.delegate_person_id) throw new Error("Pick who owns it.");
    await supabase
      .from("tasks")
      .update({ owner: "them", person_id: decision.delegate_person_id })
      .eq("id", decision.task_id);
  }

  const review = await getReview(supabase, userId, week);
  const decisions = [
    ...(review.slipped_decisions ?? []).filter((d) => d.task_id !== decision.task_id),
    decision,
  ];
  await supabase
    .from("weekly_reviews")
    .update({ slipped_decisions: decisions })
    .eq("id", review.id);
  revalidatePath(`/review/${week}/2`);
}

const dormantSchema = z.object({
  project_id: z.string().uuid().optional(),
  person_id: z.string().uuid().optional(),
  decision: z.enum(["revive", "park", "close"]),
  next_action: z.string().trim().max(300).optional(),
});

/** Step 3: revive, park or close each dormant project and lapsed person. */
export async function recordDormantDecision(
  weekStart: string,
  input: DormantDecision,
): Promise<void> {
  const { supabase, userId } = await session();
  const week = weekSchema.parse(weekStart);
  const decision = dormantSchema.parse(input);

  if (decision.project_id) {
    const { data: project } = await supabase
      .from("projects")
      .select("id, domain_id")
      .eq("id", decision.project_id)
      .single();

    if (decision.decision === "revive") {
      if (!decision.next_action) throw new Error("Type the next action.");
      await supabase.from("tasks").insert({
        user_id: userId,
        domain_id: project!.domain_id,
        project_id: project!.id,
        title: decision.next_action,
        origin: "manual",
      });
      await supabase
        .from("projects")
        .update({ status: "active", last_activity_at: new Date().toISOString() })
        .eq("id", project!.id);
    } else {
      await supabase
        .from("projects")
        .update({ status: decision.decision === "park" ? "parked" : "done" })
        .eq("id", decision.project_id);
    }
  } else if (decision.person_id) {
    if (decision.decision === "revive") {
      if (!decision.next_action) throw new Error("Type the next action.");
      const { data: person } = await supabase
        .from("people")
        .select("id, domain_id")
        .eq("id", decision.person_id)
        .single();
      let domainId = person?.domain_id ?? null;
      if (!domainId) {
        const { data: personal } = await supabase
          .from("domains")
          .select("id")
          .eq("user_id", userId)
          .eq("slug", "personal")
          .maybeSingle();
        domainId = personal?.id ?? null;
      }
      if (!domainId) throw new Error("No domain to file that under.");
      await supabase.from("tasks").insert({
        user_id: userId,
        domain_id: domainId,
        person_id: decision.person_id,
        title: decision.next_action,
        origin: "manual",
      });
    } else {
      // Park: stop the cadence nudges for this person.
      await supabase
        .from("people")
        .update({ follow_up_every_days: null, next_follow_up_at: null })
        .eq("id", decision.person_id);
    }
  }

  const review = await getReview(supabase, userId, week);
  const key = decision.project_id ?? decision.person_id;
  const decisions = [
    ...(review.dormant_decisions ?? []).filter((d) => (d.project_id ?? d.person_id) !== key),
    decision,
  ];
  await supabase.from("weekly_reviews").update({ dormant_decisions: decisions }).eq("id", review.id);
  revalidatePath(`/review/${week}/3`);
}

export async function goToStep(weekStart: string, step: number): Promise<void> {
  const { supabase, userId } = await session();
  const week = weekSchema.parse(weekStart);
  const target = z.number().int().min(1).max(5).parse(step);
  await getReview(supabase, userId, week);
  await advance(supabase, userId, week, target);
  redirect(`/review/${week}/${target}`);
}

const pickSchema = z.array(
  z.object({ type: z.enum(["task", "suggestion"]), id: z.string().uuid() }),
).max(3);

/**
 * Step 4: the week's top three. Picking a pending suggestion accepts it first —
 * a top-three slot has to point at a real task.
 */
export async function saveTop3(
  weekStart: string,
  picks: { type: "task" | "suggestion"; id: string }[],
): Promise<void> {
  const { supabase, userId } = await session();
  const week = weekSchema.parse(weekStart);
  const parsed = pickSchema.parse(picks);

  const taskIds: string[] = [];
  for (const pick of parsed) {
    if (pick.type === "task") {
      taskIds.push(pick.id);
      continue;
    }
    await acceptSuggestion(pick.id);
    const { data } = await supabase
      .from("suggestions")
      .select("resulting_task_id")
      .eq("id", pick.id)
      .maybeSingle();
    if (data?.resulting_task_id) taskIds.push(data.resulting_task_id);
  }

  const review = await getReview(supabase, userId, week);
  await supabase.from("weekly_reviews").update({ week_top3: taskIds }).eq("id", review.id);
  revalidatePath(`/review/${week}/4`);
}

export async function generateCoach(weekStart: string): Promise<void> {
  const { supabase, userId } = await session();
  const week = weekSchema.parse(weekStart);
  await getReview(supabase, userId, week);
  await runWeeklyCoach(supabase, userId, week);
  await advance(supabase, userId, week, 5);
  revalidatePath(`/review/${week}/5`);
}

export async function setOneChangeAccepted(weekStart: string, accepted: boolean): Promise<void> {
  const { supabase, userId } = await session();
  const week = weekSchema.parse(weekStart);
  await supabase
    .from("weekly_reviews")
    .update({ one_change_accepted: z.boolean().parse(accepted) })
    .eq("user_id", userId)
    .eq("week_start", week);
  revalidatePath(`/review/${week}/5`);
}

export async function finishReview(weekStart: string): Promise<void> {
  const { supabase, userId } = await session();
  const week = weekSchema.parse(weekStart);
  await supabase
    .from("weekly_reviews")
    .update({ status: "done", step_reached: 5, completed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("week_start", week);
  revalidatePath("/review");
  revalidatePath("/today");
  redirect("/today?review=done");
}
