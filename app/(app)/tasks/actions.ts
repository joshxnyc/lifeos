"use server";

// Task and project mutations (SPEC §4.1–4.2). Every action is zod-validated,
// returns an ActionResult instead of throwing, refuses to touch mirrored rows
// (CONTRACTS ground rule 7) and bumps projects.last_activity_at (rule 8).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, currentUserId } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { localDate } from "@/lib/time";
import { nextOccurrence } from "@/lib/domain/recurrence";
import {
  removeTaskCalendarEvent,
  syncTaskCalendarEvent,
} from "@/lib/integrations/google/calendar-write";
import type { Project, Task } from "@/lib/types";
import type {
  ActionResult,
  CreateProjectInput,
  CreateTaskInput,
  RescheduleInput,
  UpdateProjectInput,
  UpdateTaskInput,
} from "@/components/tasks/types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();

// Keeps an app-created calendar block in step with its task (SPEC §6.1c).
// Best-effort: a Google hiccup must never fail the task mutation.
async function syncCalendarBlock(task: Pick<Task, "calendar_event_id">, taskId: string) {
  if (!task.calendar_event_id) return;
  try {
    await syncTaskCalendarEvent(taskId);
  } catch {
    // sync-google surfaces persistent calendar failures; ignore here
  }
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
const timeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use a HH:MM time.");
const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const createTaskSchema = z.object({
  title: z.string().trim().min(1, "A task needs a title.").max(500),
  domain_id: uuid.optional(),
  project_id: uuid.nullish(),
  person_id: uuid.nullish(),
  priority: priority.optional(),
  due_date: dateStr.nullish(),
  due_time: timeStr.nullish(),
  scheduled_date: dateStr.nullish(),
  body_md: z.string().max(20_000).nullish(),
  owner: z.enum(["me", "them"]).optional(),
  recurrence_rule: z.string().trim().max(500).nullish(),
  origin: z.enum(["manual", "capture", "suggestion"]).optional(),
  origin_id: z.string().max(200).nullish(),
  source_item_id: uuid.nullish(),
});

const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(["open", "done", "dropped"]).optional(),
});

const rescheduleSchema = z
  .object({
    due_date: dateStr.nullish(),
    due_time: timeStr.nullish(),
    scheduled_date: dateStr.nullish(),
  })
  .refine(
    (v) => "due_date" in v || "scheduled_date" in v || "due_time" in v,
    "Nothing to reschedule.",
  );

const createProjectSchema = z.object({
  name: z.string().trim().min(1, "A project needs a name.").max(200),
  domain_id: uuid,
  kind: z.enum(["project", "area"]).default("project"),
  description: z.string().max(20_000).nullish(),
  target_date: dateStr.nullish(),
});

const updateProjectSchema = createProjectSchema.partial().extend({
  status: z.enum(["active", "parked", "done"]).optional(),
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface Ctx {
  supabase: SupabaseClient;
  userId: string;
}

async function ctx(): Promise<Ctx | null> {
  const supabase = await createClient();
  const userId = await currentUserId();
  if (!userId) return null;
  return { supabase, userId };
}

const SIGNED_OUT: ActionResult = { ok: false, error: "Session expired. Sign in again." };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "That input isn't valid.";
}

async function loadTask(c: Ctx, id: string): Promise<Task | null> {
  const { data } = await c.supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  return (data as Task | null) ?? null;
}

async function loadProject(c: Ctx, id: string): Promise<Project | null> {
  const { data } = await c.supabase.from("projects").select("*").eq("id", id).maybeSingle();
  return (data as Project | null) ?? null;
}

/** Ground rule 8: any task write touching a project bumps its activity clock. */
async function bumpProjects(c: Ctx, ids: Array<string | null | undefined>): Promise<void> {
  const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v))));
  if (unique.length === 0) return;
  await c.supabase
    .from("projects")
    .update({ last_activity_at: new Date().toISOString() })
    .in("id", unique);
}

async function todayFor(c: Ctx): Promise<string> {
  const settings = await getSettings(c.supabase, c.userId);
  return localDate(new Date(), settings.timezone);
}

function revalidateTaskViews() {
  revalidatePath("/today");
  revalidatePath("/tasks");
  revalidatePath("/domains/[slug]", "page");
  revalidatePath("/projects/[id]", "page");
}

function revalidateProjectViews() {
  revalidatePath("/domains/[slug]", "page");
  revalidatePath("/projects/[id]", "page");
  revalidatePath("/today");
  revalidatePath("/tasks");
}

/** Empty strings from form inputs mean "clear this column". */
function nullable<T>(value: T | null | undefined): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return value;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function createTask(input: CreateTaskInput): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;

  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;

  let domainId = v.domain_id;
  if (!domainId) {
    const { data } = await c.supabase
      .from("domains")
      .select("id")
      .eq("slug", "personal")
      .maybeSingle();
    domainId = (data as { id: string } | null)?.id;
  }
  if (!domainId) return { ok: false, error: "No domain to file this under." };

  if (v.owner === "them" && !v.person_id) {
    return { ok: false, error: "A task someone else owes you needs a person." };
  }

  const { data, error } = await c.supabase
    .from("tasks")
    .insert({
      user_id: c.userId,
      domain_id: domainId,
      project_id: nullable(v.project_id) ?? null,
      person_id: nullable(v.person_id) ?? null,
      title: v.title,
      body_md: nullable(v.body_md) ?? null,
      priority: v.priority ?? 0,
      due_date: nullable(v.due_date) ?? null,
      due_time: nullable(v.due_time) ?? null,
      scheduled_date: nullable(v.scheduled_date) ?? null,
      owner: v.owner ?? "me",
      origin: v.origin ?? "manual",
      origin_id: nullable(v.origin_id) ?? null,
      source_item_id: nullable(v.source_item_id) ?? null,
      recurrence_rule: nullable(v.recurrence_rule) ?? null,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  await bumpProjects(c, [v.project_id]);
  revalidateTaskViews();
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateTask(id: string, patch: UpdateTaskInput): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown task." };

  const parsed = updateTaskSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const task = await loadTask(c, id);
  if (!task) return { ok: false, error: "That task no longer exists." };
  if (task.is_mirror) return { ok: false, error: "Mirrored tasks are edited in Notion." };

  const v = parsed.data;
  const fields: Record<string, unknown> = {};
  if (v.title !== undefined) fields.title = v.title;
  if (v.body_md !== undefined) fields.body_md = nullable(v.body_md);
  if (v.domain_id !== undefined) fields.domain_id = v.domain_id;
  if (v.project_id !== undefined) fields.project_id = nullable(v.project_id);
  if (v.person_id !== undefined) fields.person_id = nullable(v.person_id);
  if (v.priority !== undefined) fields.priority = v.priority;
  if (v.due_date !== undefined) fields.due_date = nullable(v.due_date);
  if (v.due_time !== undefined) fields.due_time = nullable(v.due_time);
  if (v.scheduled_date !== undefined) fields.scheduled_date = nullable(v.scheduled_date);
  if (v.owner !== undefined) fields.owner = v.owner;
  if (v.recurrence_rule !== undefined) fields.recurrence_rule = nullable(v.recurrence_rule);
  if (v.status !== undefined) {
    fields.status = v.status;
    fields.completed_at = v.status === "done" ? new Date().toISOString() : null;
  }

  const owner = (v.owner ?? task.owner) as string;
  const personId = v.person_id === undefined ? task.person_id : nullable(v.person_id);
  if (owner === "them" && !personId) {
    return { ok: false, error: "A task someone else owes you needs a person." };
  }

  if (Object.keys(fields).length === 0) return { ok: true, id };

  const { error } = await c.supabase.from("tasks").update(fields).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await bumpProjects(c, [task.project_id, v.project_id]);
  await syncCalendarBlock(task, id);
  revalidateTaskViews();
  return { ok: true, id };
}

/**
 * Complete a task. When it recurs, the next occurrence is spawned with the
 * same fields and a new due date — anchored to the later of its own date and
 * today, so a long-overdue routine task doesn't respawn in the past.
 */
export async function completeTask(id: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown task." };

  const task = await loadTask(c, id);
  if (!task) return { ok: false, error: "That task no longer exists." };
  if (task.is_mirror) return { ok: false, error: "Mirrored tasks are completed in Notion." };
  if (task.status === "done") return { ok: true, id };

  const { error } = await c.supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString(), dropped_reason: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  if (task.recurrence_rule) {
    const today = await todayFor(c);
    const anchor = task.due_date ?? task.scheduled_date ?? today;
    const after = anchor < today ? today : anchor;
    let next: string | null = null;
    try {
      next = nextOccurrence(task.recurrence_rule, after);
    } catch {
      next = null; // an unparseable rule must never block completing the task
    }
    if (next) {
      await c.supabase.from("tasks").insert({
        user_id: c.userId,
        domain_id: task.domain_id,
        project_id: task.project_id,
        person_id: task.person_id,
        title: task.title,
        body_md: task.body_md,
        priority: task.priority,
        due_date: task.due_date ? next : null,
        due_time: task.due_time,
        scheduled_date: task.scheduled_date ? next : null,
        owner: task.owner,
        origin: task.origin,
        origin_id: task.origin_id,
        source_item_id: task.source_item_id,
        recurrence_rule: task.recurrence_rule,
        sort_order: task.sort_order,
      });
    }
  }

  await bumpProjects(c, [task.project_id]);
  await syncCalendarBlock(task, id); // done → the event title gets a "✓"
  revalidateTaskViews();
  return { ok: true, id };
}

export async function reopenTask(id: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown task." };

  const task = await loadTask(c, id);
  if (!task) return { ok: false, error: "That task no longer exists." };
  if (task.is_mirror) return { ok: false, error: "Mirrored tasks are managed in Notion." };

  const { error } = await c.supabase
    .from("tasks")
    .update({ status: "open", completed_at: null, dropped_reason: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await bumpProjects(c, [task.project_id]);
  revalidateTaskViews();
  return { ok: true, id };
}

export async function dropTask(id: string, reason: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown task." };

  const parsedReason = z.string().trim().max(500).safeParse(reason);
  if (!parsedReason.success) return { ok: false, error: "That reason is too long." };

  const task = await loadTask(c, id);
  if (!task) return { ok: false, error: "That task no longer exists." };
  if (task.is_mirror) return { ok: false, error: "Mirrored tasks are dropped in Notion." };

  const { error } = await c.supabase
    .from("tasks")
    .update({
      status: "dropped",
      dropped_reason: parsedReason.data || null,
      completed_at: null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await bumpProjects(c, [task.project_id]);
  revalidateTaskViews();
  return { ok: true, id };
}

export async function rescheduleTask(id: string, input: RescheduleInput): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown task." };

  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const task = await loadTask(c, id);
  if (!task) return { ok: false, error: "That task no longer exists." };
  if (task.is_mirror) return { ok: false, error: "Mirrored tasks are rescheduled in Notion." };

  const v = parsed.data;
  const fields: Record<string, unknown> = {};
  if (v.due_date !== undefined) fields.due_date = nullable(v.due_date);
  if (v.due_time !== undefined) fields.due_time = nullable(v.due_time);
  if (v.scheduled_date !== undefined) fields.scheduled_date = nullable(v.scheduled_date);

  const { error } = await c.supabase.from("tasks").update(fields).eq("id", id);
  if (error) return { ok: false, error: error.message };

  await bumpProjects(c, [task.project_id]);
  await syncCalendarBlock(task, id);
  revalidateTaskViews();
  return { ok: true, id };
}

export async function deleteTask(id: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown task." };

  const task = await loadTask(c, id);
  if (!task) return { ok: true, id };
  if (task.is_mirror) return { ok: false, error: "Mirrored tasks are deleted in Notion." };

  if (task.calendar_event_id) {
    try {
      await removeTaskCalendarEvent(id); // app-created events only (SPEC §6.1)
    } catch {
      // never block the delete on a calendar failure
    }
  }
  const { error } = await c.supabase.from("tasks").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await bumpProjects(c, [task.project_id]);
  revalidateTaskViews();
  return { ok: true, id };
}

// ---------------------------------------------------------------------------
// Projects and areas
// ---------------------------------------------------------------------------

export async function createProject(input: CreateProjectInput): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;

  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;

  const { data, error } = await c.supabase
    .from("projects")
    .insert({
      user_id: c.userId,
      domain_id: v.domain_id,
      kind: v.kind,
      name: v.name,
      description: nullable(v.description) ?? null,
      // Areas are ongoing; only projects carry a target date (SPEC §4.1).
      target_date: v.kind === "area" ? null : (nullable(v.target_date) ?? null),
      last_activity_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidateProjectViews();
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateProject(id: string, patch: UpdateProjectInput): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return SIGNED_OUT;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Unknown project." };

  const parsed = updateProjectSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const project = await loadProject(c, id);
  if (!project) return { ok: false, error: "That project no longer exists." };
  if (project.notion_url) return { ok: false, error: "Mirrored projects are edited in Notion." };

  const v = parsed.data;
  const fields: Record<string, unknown> = { last_activity_at: new Date().toISOString() };
  if (v.name !== undefined) fields.name = v.name;
  if (v.domain_id !== undefined) fields.domain_id = v.domain_id;
  if (v.kind !== undefined) fields.kind = v.kind;
  if (v.description !== undefined) fields.description = nullable(v.description);
  if (v.target_date !== undefined) fields.target_date = nullable(v.target_date);
  if (v.status !== undefined) fields.status = v.status;
  if ((v.kind ?? project.kind) === "area") fields.target_date = null;

  const { error } = await c.supabase.from("projects").update(fields).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidateProjectViews();
  return { ok: true, id };
}

export async function parkProject(id: string): Promise<ActionResult> {
  return updateProject(id, { status: "parked" });
}

export async function closeProject(id: string): Promise<ActionResult> {
  return updateProject(id, { status: "done" });
}

export async function reviveProject(id: string): Promise<ActionResult> {
  return updateProject(id, { status: "active" });
}
