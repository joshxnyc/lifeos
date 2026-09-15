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
