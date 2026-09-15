"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { localDate } from "@/lib/time";
import type { Suggestion, SuggestionProposed } from "@/lib/types";

// SPEC §7.2 queue actions. Accept creates the row the suggestion proposed
// (editable inline before accepting) and links it back to the source item;
// dismiss only marks the suggestion.

const editedSchema = z
  .object({
    domain_id: z.string().uuid().optional(),
    project_id: z.string().uuid().nullable().optional(),
    person_id: z.string().uuid().nullable().optional(),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    priority: z.number().int().min(0).max(3).optional(),
    existing_task_id: z.string().uuid().optional(),
    owner: z.enum(["me", "them"]).optional(),
    target_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    status: z.enum(["active", "parked", "done"]).optional(),
    fact: z.string().max(2000).optional(),
  })
  .strict();

async function session(): Promise<{ supabase: SupabaseClient; userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

async function bumpProject(supabase: SupabaseClient, projectId: string | null | undefined) {
  if (!projectId) return;
  await supabase
    .from("projects")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", projectId);
}

/**
 * Accept a suggestion, optionally with the edits Joshua made on the card.
 * Everything a kind can create is created here; the suggestion is then closed
 * with `accepted` and, where it made one, the resulting task id.
 */
export async function acceptSuggestion(id: string, edited?: Partial<SuggestionProposed>): Promise<void> {
  const { supabase, userId } = await session();
  const patch = edited ? (editedSchema.parse(edited) as Partial<SuggestionProposed>) : {};

  const { data: row, error } = await supabase
    .from("suggestions")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !row) throw new Error("Suggestion not found.");
  const suggestion = row as Suggestion;
  if (suggestion.status !== "pending") return; // already resolved: idempotent

  const proposed: SuggestionProposed = { ...(suggestion.proposed ?? {}), ...patch };
  const settings = await getSettings(supabase, userId);
  const today = localDate(new Date(), settings.timezone);
  let resultingTaskId: string | null = null;

  if (suggestion.kind === "task" || suggestion.kind === "follow_up") {
    const domainId = proposed.domain_id ?? (await fallbackDomainId(supabase, userId, suggestion));
    if (!domainId) throw new Error("No domain for this task. Pick one before accepting.");

    // owner 'them' requires a person (DB constraint them_requires_person).
    const owner =
      (suggestion.kind === "follow_up" ? "them" : (proposed.owner ?? "me")) === "them" && proposed.person_id
        ? "them"
        : "me";

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .insert({
        user_id: userId,
        domain_id: domainId,
        project_id: proposed.project_id ?? null,
        person_id: proposed.person_id ?? null,
        title: suggestion.title,
        body_md: suggestion.detail ?? null,
        priority: proposed.priority ?? 0,
        due_date: proposed.due_date ?? null,
        owner,
        origin: "suggestion",
        origin_id: suggestion.id,
        source_item_id: suggestion.source_item_id,
      })
      .select("id")
      .single();
    if (taskError) throw new Error(`accept: ${taskError.message}`);
    resultingTaskId = task.id;
    await bumpProject(supabase, proposed.project_id);
  } else if (suggestion.kind === "deadline_change") {
    if (!proposed.existing_task_id || !proposed.due_date) {
      throw new Error("This deadline change needs a task and a date.");
    }
    const { error: updateError } = await supabase
      .from("tasks")
      .update({ due_date: proposed.due_date })
      .eq("id", proposed.existing_task_id);
    if (updateError) throw new Error(`accept: ${updateError.message}`);
    resultingTaskId = proposed.existing_task_id;
  } else if (suggestion.kind === "person_fact") {
    let personId = proposed.person_id ?? null;
    if (!personId && proposed.new_person?.name) {
      const { data: person, error: personError } = await supabase
        .from("people")
        .insert({
          user_id: userId,
          name: proposed.new_person.name,
          company: proposed.new_person.company ?? null,
          role: proposed.new_person.role ?? null,
          domain_id: proposed.domain_id ?? null,
        })
        .select("id")
        .single();
      if (personError) throw new Error(`accept: ${personError.message}`);
      personId = person.id;
    }
    if (!personId) throw new Error("This fact needs a person. Pick one before accepting.");

    const fact = (proposed.fact ?? suggestion.detail ?? suggestion.title).trim();
    const { data: person } = await supabase.from("people").select("notes_md").eq("id", personId).single();
    const line = `- [${today}] ${fact}`;
    await supabase
      .from("people")
      .update({ notes_md: person?.notes_md ? `${person.notes_md.trimEnd()}\n${line}` : line })
      .eq("id", personId);
  } else if (suggestion.kind === "project_update") {
    const projectId = proposed.project_id;
    if (!projectId) throw new Error("This update needs a project. Pick one before accepting.");
    const { data: project } = await supabase
      .from("projects")
      .select("description")
      .eq("id", projectId)
      .single();
    const line = `- [${today}] ${(suggestion.detail ?? suggestion.title).trim()}`;
    const update: Record<string, unknown> = {
      description: project?.description ? `${project.description.trimEnd()}\n${line}` : line,
      last_activity_at: new Date().toISOString(),
    };
    if (proposed.target_date) update.target_date = proposed.target_date;
    if (proposed.status) update.status = proposed.status;
    const { error: projectError } = await supabase.from("projects").update(update).eq("id", projectId);
    if (projectError) throw new Error(`accept: ${projectError.message}`);
  }

  await supabase
    .from("suggestions")
    .update({
      status: "accepted",
      resolved_at: new Date().toISOString(),
      resulting_task_id: resultingTaskId,
      proposed,
    })
    .eq("id", suggestion.id);

  revalidatePath("/queue");
  revalidatePath("/today");
}

export async function dismissSuggestion(id: string): Promise<void> {
  const { supabase } = await session();
  const { error } = await supabase
    .from("suggestions")
    .update({ status: "dismissed", resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(`dismiss: ${error.message}`);
  revalidatePath("/queue");
}

async function fallbackDomainId(
  supabase: SupabaseClient,
  userId: string,
  suggestion: Suggestion,
): Promise<string | null> {
  if (suggestion.source_item_id) {
    const { data: item } = await supabase
      .from("source_items")
      .select("domain_id")
      .eq("id", suggestion.source_item_id)
      .maybeSingle();
    if (item?.domain_id) return item.domain_id;
  }
  const { data: personal } = await supabase
    .from("domains")
    .select("id")
    .eq("user_id", userId)
    .eq("slug", "personal")
    .maybeSingle();
  return personal?.id ?? null;
}
