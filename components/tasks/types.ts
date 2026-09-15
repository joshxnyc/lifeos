import type { DomainSlug, Task } from "@/lib/types";

/**
 * A task row joined with the labels every list needs. Built server-side by
 * `toTaskView()` in app/(app)/tasks/queries.ts and passed to client rows.
 */
export interface TaskView extends Task {
  domain_slug: DomainSlug;
  domain_name: string;
  project_name: string | null;
  person_name: string | null;
  /** Notion (or other source) URL — mirror tasks open here instead of editing. */
  external_url: string | null;
}

/** Every server action in this workstream returns this shape, never throws. */
export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

export interface DomainOption {
  id: string;
  slug: DomainSlug;
  name: string;
}

export interface ProjectOption {
  id: string;
  name: string;
  domain_id: string;
}

export interface PersonOption {
  id: string;
  name: string;
}

// Server-action inputs live here (not in the "use server" module) so client
// code can import the shapes without pulling in server code.

export interface CreateTaskInput {
  title: string;
  domain_id?: string;
  project_id?: string | null;
  person_id?: string | null;
  priority?: 0 | 1 | 2 | 3;
  due_date?: string | null;
  due_time?: string | null;
  scheduled_date?: string | null;
  body_md?: string | null;
  owner?: "me" | "them";
  recurrence_rule?: string | null;
  origin?: "manual" | "capture" | "suggestion";
  origin_id?: string | null;
  source_item_id?: string | null;
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  status?: "open" | "done" | "dropped";
}

export interface RescheduleInput {
  due_date?: string | null;
  due_time?: string | null;
  scheduled_date?: string | null;
}

export interface CreateProjectInput {
  name: string;
  domain_id: string;
  kind?: "project" | "area";
  description?: string | null;
  target_date?: string | null;
}

export interface UpdateProjectInput extends Partial<CreateProjectInput> {
  status?: "active" | "parked" | "done";
}
