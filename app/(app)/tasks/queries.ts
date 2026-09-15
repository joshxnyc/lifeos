// Shared task reads for Today, Tasks, Domain and Project screens. Server-only:
// every caller is a server component holding an RLS client.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Domain, DomainSlug, Project, Task } from "@/lib/types";
import type { DomainOption, PersonOption, ProjectOption, TaskView } from "@/components/tasks/types";

/** Joined columns every task row needs — domain edge, project name, person, mirror link. */
export const TASK_SELECT =
  "*, domains(slug,name), projects(id,name), people(id,name), source_items(external_url)";

interface JoinedTask extends Task {
  domains: { slug: DomainSlug; name: string } | null;
  projects: { id: string; name: string } | null;
  people: { id: string; name: string } | null;
  source_items: { external_url: string | null } | null;
}

export function toTaskView(row: unknown): TaskView {
  const t = row as JoinedTask;
  return {
    ...(t as Task),
    domain_slug: t.domains?.slug ?? "misc",
    domain_name: t.domains?.name ?? "Misc",
    project_name: t.projects?.name ?? null,
    person_name: t.people?.name ?? null,
    external_url: t.source_items?.external_url ?? null,
  };
}

export function toTaskViews(rows: unknown[] | null): TaskView[] {
  return (rows ?? []).map(toTaskView);
}

export function domainOptions(domains: Domain[]): DomainOption[] {
  return domains.map((d) => ({ id: d.id, slug: d.slug, name: d.name }));
}

export function projectOptions(projects: Project[]): ProjectOption[] {
  return projects.map((p) => ({ id: p.id, name: p.name, domain_id: p.domain_id }));
}

/** Domains and active projects, plus people for quick-add resolution. */
export async function loadQuickAddContext(supabase: SupabaseClient): Promise<{
  domains: DomainOption[];
  projects: ProjectOption[];
  people: PersonOption[];
}> {
  const [{ data: domains }, { data: projects }, { data: people }] = await Promise.all([
    supabase.from("domains").select("id, slug, name").order("sort_order"),
    supabase
      .from("projects")
      .select("id, name, domain_id")
      .eq("status", "active")
      .order("sort_order"),
    supabase.from("people").select("id, name").order("last_contact_at", { ascending: false }).limit(300),
  ]);
  return {
    domains: (domains ?? []) as DomainOption[],
    projects: (projects ?? []) as ProjectOption[],
    people: (people ?? []) as PersonOption[],
  };
}

export interface TodayGroups {
  overdue: TaskView[];
  dueToday: TaskView[];
  scheduledToday: TaskView[];
  rollingOver: TaskView[];
}

/**
 * Open tasks that belong on Today, in exactly one group each (SPEC §10 Phase 1).
 * Rolling over = open and dated before today by `scheduled_date` only; anything
 * with a past `due_date` is already Overdue.
 */
export function groupToday(tasks: TaskView[], today: string): TodayGroups {
  const groups: TodayGroups = { overdue: [], dueToday: [], scheduledToday: [], rollingOver: [] };
  for (const t of tasks) {
    if (t.due_date && t.due_date < today) groups.overdue.push(t);
    else if (t.due_date === today) groups.dueToday.push(t);
    else if (t.scheduled_date === today) groups.scheduledToday.push(t);
    else if (t.scheduled_date && t.scheduled_date < today) groups.rollingOver.push(t);
  }
  const byUrgency = (a: TaskView, b: TaskView) => {
    const da = a.due_date ?? a.scheduled_date ?? "9999-12-31";
    const db = b.due_date ?? b.scheduled_date ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return (a.due_time ?? "99:99").localeCompare(b.due_time ?? "99:99");
  };
  groups.overdue.sort(byUrgency);
  groups.dueToday.sort(byUrgency);
  groups.scheduledToday.sort(byUrgency);
  groups.rollingOver.sort(byUrgency);
  return groups;
}

/** Everything open that is due or scheduled on/before `today`. */
export async function loadTodayTasks(supabase: SupabaseClient, today: string): Promise<TaskView[]> {
  const { data } = await supabase
    .from("tasks")
    .select(TASK_SELECT)
    .eq("status", "open")
    .or(`due_date.lte.${today},scheduled_date.lte.${today}`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(300);
  return toTaskViews(data);
}
