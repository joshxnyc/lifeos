"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { localDate } from "@/lib/time";
import type { ProjectStatus, Suggestion, SuggestionProposed } from "@/lib/types";

// SPEC §7.2 queue actions. Accept creates the row the suggestion proposed
// (editable inline before accepting) and links it back to the source item;
// dismiss only marks the suggestion. Both are undoable for the life of the
// toast: undo reverses what accept wrote and returns the card to pending.

/**
 * What acceptSuggestion needs to remember to reverse itself. Stored inside
 * the suggestion's `proposed` jsonb under `_undo` while the suggestion is
 * accepted, and stripped again when an undo returns it to pending. Kept
 * server-side so the client can never fabricate an undo payload.
 */
interface AcceptUndo {
  /** deadline_change: the due date the task had before accept moved it. */
  prev_due_date?: string | null;
  /** person_fact: the person written to, and the exact line appended. */
  person_id?: string;
  created_person?: boolean;
  line?: string;
  /** project_update: the project written to, and prior values accept changed. */
  project_id?: string;
  prev_target_date?: string | null;
  prev_status?: ProjectStatus;
}

type StoredProposed = SuggestionProposed & { _undo?: AcceptUndo };

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
 * Every id in `proposed` was written by the model from third-party text, so
 * none of them is trusted: an id that doesn't resolve to one of Joshua's own
 * rows is dropped and the accept continues without that link (the domain then
 * falls back to the item's, or Personal).
 */
async function sanitizeIds(
  supabase: SupabaseClient,
  userId: string,
  proposed: SuggestionProposed,
): Promise<SuggestionProposed> {
  const owns = async (table: string, id: string | null | undefined): Promise<boolean> => {
    if (!id) return false;
    const { data } = await supabase
      .from(table)
      .select("id")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    return Boolean(data);
  };

  const clean: SuggestionProposed = { ...proposed };
  if (!(await owns("domains", clean.domain_id))) delete clean.domain_id;
  if (!(await owns("projects", clean.project_id))) delete clean.project_id;
  if (!(await owns("people", clean.person_id))) delete clean.person_id;
  if (!(await owns("tasks", clean.existing_task_id))) delete clean.existing_task_id;
  return clean;
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

  const proposed = await sanitizeIds(supabase, userId, {
    ...(suggestion.proposed ?? {}),
    ...patch,
  });
  const settings = await getSettings(supabase, userId);
  const today = localDate(new Date(), settings.timezone);
  let resultingTaskId: string | null = null;
  let undo: AcceptUndo | undefined;

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
    // The model supplies existing_task_id; a stale or hallucinated id would
    // otherwise update nothing and then break the resulting_task_id foreign
    // key, leaving the card "accepted" on screen and pending in the database.
    const { data: target } = await supabase
      .from("tasks")
      .select("id, is_mirror, due_date")
      .eq("id", proposed.existing_task_id)
      .maybeSingle();
    if (!target) throw new Error("That task no longer exists. Dismiss this one.");
    if (target.is_mirror) throw new Error("Mirrored tasks are rescheduled in Notion.");

    const { error: updateError } = await supabase
      .from("tasks")
      .update({ due_date: proposed.due_date })
      .eq("id", proposed.existing_task_id);
    if (updateError) throw new Error(`accept: ${updateError.message}`);
    resultingTaskId = proposed.existing_task_id;
    undo = { prev_due_date: (target.due_date as string | null) ?? null };
  } else if (suggestion.kind === "person_fact") {
    let personId = proposed.person_id ?? null;
    let createdPerson = false;
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
      createdPerson = true;
    }
    if (!personId) throw new Error("This fact needs a person. Pick one before accepting.");

    const fact = (proposed.fact ?? suggestion.detail ?? suggestion.title).trim();
    const { data: person } = await supabase.from("people").select("notes_md").eq("id", personId).single();
    const line = `- [${today}] ${fact}`;
    await supabase
      .from("people")
      .update({ notes_md: person?.notes_md ? `${person.notes_md.trimEnd()}\n${line}` : line })
      .eq("id", personId);
    undo = { person_id: personId, line, created_person: createdPerson };
  } else if (suggestion.kind === "project_update") {
    const projectId = proposed.project_id;
    if (!projectId) throw new Error("This update needs a project. Pick one before accepting.");
    const { data: project } = await supabase
      .from("projects")
      .select("description, target_date, status")
      .eq("id", projectId)
      .single();
    const line = `- [${today}] ${(suggestion.detail ?? suggestion.title).trim()}`;
    const update: Record<string, unknown> = {
      description: project?.description ? `${project.description.trimEnd()}\n${line}` : line,
      last_activity_at: new Date().toISOString(),
    };
    undo = { project_id: projectId, line };
    if (proposed.target_date) {
      update.target_date = proposed.target_date;
      undo.prev_target_date = (project?.target_date as string | null) ?? null;
    }
    if (proposed.status) {
      update.status = proposed.status;
      undo.prev_status = (project?.status as ProjectStatus | null) ?? "active";
    }
    const { error: projectError } = await supabase.from("projects").update(update).eq("id", projectId);
    if (projectError) throw new Error(`accept: ${projectError.message}`);
  }

  const stored: StoredProposed = undo ? { ...proposed, _undo: undo } : proposed;
  const { error: closeError } = await supabase
    .from("suggestions")
    .update({
      status: "accepted",
      resolved_at: new Date().toISOString(),
      resulting_task_id: resultingTaskId,
      proposed: stored,
    })
    .eq("id", suggestion.id);
  if (closeError) throw new Error(`accept: ${closeError.message}`);

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

/**
 * Undo an accept (the toast's Undo action): reverse what accept wrote for
 * this kind, then return the suggestion to pending so the card reappears.
 * The reversal only touches rows that still look exactly as accept left them
 * — anything already changed by hand stays, and the undo refuses instead of
 * clobbering it.
 */
export async function undoAcceptSuggestion(id: string): Promise<void> {
  const { supabase } = await session();
  if (!z.string().uuid().safeParse(id).success) throw new Error("Unknown suggestion.");

  const { data: row, error } = await supabase
    .from("suggestions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) throw new Error("Suggestion not found.");
  const suggestion = row as Suggestion;
  if (suggestion.status !== "accepted") return; // already undone or never accepted

  const stored = (suggestion.proposed ?? {}) as StoredProposed;
  const { _undo: undo, ...proposed } = stored;

  if (suggestion.kind === "task" || suggestion.kind === "follow_up") {
    // Accept created a task: delete it, but only while it is untouched —
    // still open and still the row this suggestion made.
    if (suggestion.resulting_task_id) {
      const { data: task } = await supabase
        .from("tasks")
        .select("id, status, origin, origin_id, project_id")
        .eq("id", suggestion.resulting_task_id)
        .maybeSingle();
      if (task) {
        if (task.status !== "open" || task.origin !== "suggestion" || task.origin_id !== suggestion.id) {
          throw new Error("That task was already changed, so this stays accepted.");
        }
        const { error: deleteError } = await supabase.from("tasks").delete().eq("id", task.id);
        if (deleteError) throw new Error(`undo: ${deleteError.message}`);
        await bumpProject(supabase, task.project_id as string | null);
      }
    }
  } else if (suggestion.kind === "deadline_change") {
    // Accept moved a due date: put the old one back, unless it moved again.
    if (undo && suggestion.resulting_task_id) {
      const { data: task } = await supabase
        .from("tasks")
        .select("id, due_date, is_mirror")
        .eq("id", suggestion.resulting_task_id)
        .maybeSingle();
      if (task && !task.is_mirror) {
        if ((task.due_date ?? null) !== (proposed.due_date ?? null)) {
          throw new Error("That deadline changed again, so this stays accepted.");
        }
        const { error: revertError } = await supabase
          .from("tasks")
          .update({ due_date: undo.prev_due_date ?? null })
          .eq("id", task.id);
        if (revertError) throw new Error(`undo: ${revertError.message}`);
      }
    }
  } else if (suggestion.kind === "person_fact") {
    // Accept appended one line to a person's notes (and may have created the
    // person). Strip the line while it is still the last one; a person accept
    // created is removed again only when those notes are exactly that line.
    if (undo?.person_id && undo.line) {
      const { data: person } = await supabase
        .from("people")
        .select("id, notes_md")
        .eq("id", undo.person_id)
        .maybeSingle();
      const notes = person?.notes_md ?? "";
      if (person && notes === undo.line && undo.created_person) {
        await supabase.from("people").delete().eq("id", person.id);
      } else if (person && notes === undo.line) {
        await supabase.from("people").update({ notes_md: null }).eq("id", person.id);
      } else if (person && notes.endsWith(`\n${undo.line}`)) {
        await supabase
          .from("people")
          .update({ notes_md: notes.slice(0, -(undo.line.length + 1)) })
          .eq("id", person.id);
      }
      // Notes edited since the accept: leave them alone, just reopen the card.
    }
  } else if (suggestion.kind === "project_update") {
    // Accept appended one line to the project log and may have moved its
    // target date or status; restore what it recorded.
    if (undo?.project_id && undo.line) {
      const { data: project } = await supabase
        .from("projects")
        .select("id, description")
        .eq("id", undo.project_id)
        .maybeSingle();
      if (project) {
        const patch: Record<string, unknown> = {};
        const description = project.description ?? "";
        if (description === undo.line) patch.description = null;
        else if (description.endsWith(`\n${undo.line}`)) {
          patch.description = description.slice(0, -(undo.line.length + 1));
        }
        if ("prev_target_date" in undo) patch.target_date = undo.prev_target_date ?? null;
        if ("prev_status" in undo) patch.status = undo.prev_status;
        if (Object.keys(patch).length) {
          await supabase.from("projects").update(patch).eq("id", project.id);
        }
      }
    }
  }

  const { error: reopenError } = await supabase
    .from("suggestions")
    .update({ status: "pending", resolved_at: null, resulting_task_id: null, proposed })
    .eq("id", suggestion.id)
    .eq("status", "accepted");
  if (reopenError) throw new Error(`undo: ${reopenError.message}`);

  revalidatePath("/queue");
  revalidatePath("/today");
}

/**
 * Undo a dismiss (the toast's Undo action). Setting the row back to pending
 * also takes it out of the extractor's 30-day dismissed dedupe set — that set
 * is just a status query over recent suggestions — so nothing else needs
 * reversing and the card simply reappears in the queue.
 */
export async function undoDismissSuggestion(id: string): Promise<void> {
  const { supabase } = await session();
  if (!z.string().uuid().safeParse(id).success) throw new Error("Unknown suggestion.");
  const { error } = await supabase
    .from("suggestions")
    .update({ status: "pending", resolved_at: null })
    .eq("id", id)
    .eq("status", "dismissed");
  if (error) throw new Error(`undo: ${error.message}`);
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
