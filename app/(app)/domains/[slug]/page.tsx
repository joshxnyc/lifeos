import Link from "next/link";
import { notFound } from "next/navigation";
import { fromZonedTime } from "date-fns-tz";
import { createClient, currentUserId } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { localDate, mondayOf } from "@/lib/time";
import { isDormant } from "@/lib/domain/dormancy";
import { cn } from "@/lib/utils";
import { DOMAIN_COLOR_CLASS } from "@/components/ui/domain";
import { TaskList } from "@/components/tasks/task-list";
import { NewProjectButton } from "@/components/tasks/project-form";
import { relativeDayLabel } from "@/components/tasks/format";
import { TASK_SELECT, loadQuickAddContext, toTaskViews } from "@/app/(app)/tasks/queries";
import type { Domain, DomainSlug, Project } from "@/lib/types";

const SLUGS: DomainSlug[] = ["personal", "almedia", "tarifa", "misc"];

export default async function DomainPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUGS.includes(slug as DomainSlug)) notFound();

  const supabase = await createClient();
  const userId = await currentUserId();
  const settings = await getSettings(supabase, userId ?? "");
  const tz = settings.timezone;
  const now = new Date();
  const today = localDate(now, tz);
  const weekStart = fromZonedTime(`${mondayOf(today)}T00:00:00`, tz).toISOString();

  const { data: domainRow } = await supabase
    .from("domains")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  const domain = domainRow as Domain | null;
  if (!domain) notFound();

  const [
    { domains, projects: activeProjects },
    { data: projectRows },
    { data: openRows },
    { count: doneThisWeek },
  ] = await Promise.all([
    loadQuickAddContext(supabase),
    supabase
      .from("projects")
      .select("*")
      .eq("domain_id", domain.id)
      .neq("status", "done")
      .order("sort_order"),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("domain_id", domain.id)
      .eq("status", "open")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("priority", { ascending: false })
      .limit(300),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("domain_id", domain.id)
      .eq("status", "done")
      .gte("completed_at", weekStart),
  ]);

  const projects = (projectRows ?? []) as Project[];
  const openTasks = toTaskViews(openRows);
  const projectless = openTasks.filter((t) => !t.project_id);
  const activeCount = projects.filter((p) => p.status === "active").length;

  const nextDueFor = (projectId: string) => {
    const dates = openTasks
      .filter((t) => t.project_id === projectId && t.due_date)
      .map((t) => t.due_date as string)
      .sort();
    return dates[0] ?? null;
  };
  const openCountFor = (projectId: string) =>
    openTasks.filter((t) => t.project_id === projectId).length;

  return (
    <>
      <header className="mb-6 flex items-end justify-between gap-3 pt-6">
        <div>
          <h1 className="flex items-center gap-2.5 font-display text-[28px] font-semibold tracking-tight">
            <span className={cn("size-2.5 rounded-full", DOMAIN_COLOR_CLASS[domain.slug])} />
            {domain.name}
          </h1>
          <p className="tabular mt-0.5 text-[13px] text-ink-2">
            {openTasks.length} open · {doneThisWeek ?? 0} done this week · {activeCount} active{" "}
            {activeCount === 1 ? "project" : "projects"}
          </p>
        </div>
        <NewProjectButton domains={domains} defaultDomainId={domain.id} />
      </header>

      {domain.is_placeholder ? (
        <p className="mb-6 rounded-card border border-line px-3 py-2 text-[13px] text-ink-2">
          Nothing is connected to {domain.name} yet. Tasks here are added by hand.
        </p>
      ) : null}

      {projects.length > 0 ? (
        <section className="mb-7">
          <p className="section-label mb-1.5">Projects and areas</p>
          <ul className="border-t border-line">
            {projects.map((p) => {
              const dormant =
                p.status === "active" && safeDormant(p.last_activity_at, settings.dormancy_days, now);
              const nextDue = nextDueFor(p.id);
              return (
                <li key={p.id} className="border-b border-line last:border-b-0">
                  <Link
                    href={`/projects/${p.id}`}
                    className="flex min-h-11 items-start justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block break-words text-[15px] text-ink">{p.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-2">
                        <span>{p.kind === "area" ? "Area" : "Project"}</span>
                        {p.status !== "active" ? <span>· Parked</span> : null}
                        <span>· {openCountFor(p.id)} open</span>
                        {dormant ? <span className="text-warn">· Dormant</span> : null}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-right text-[12px] text-ink-2">
                      {nextDue ? <span className="block">Next {relativeDayLabel(nextDue, today)}</span> : null}
                      <span className="block">
                        {relativeDayLabel(localDate(new Date(p.last_activity_at), tz), today)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <TaskList
        sections={[
          {
            key: "projectless",
            label: projects.length > 0 ? "Not in a project" : "Open tasks",
            tasks: projectless,
          },
        ]}
        today={today}
        domains={domains}
        projects={activeProjects}
        emptyLine={`Nothing open in ${domain.name}.`}
        emptyAction={
          <Link href="/tasks" className="text-[14px] text-accent">
            Add a task
          </Link>
        }
      />
    </>
  );
}

function safeDormant(lastActivityAt: string, days: number, now: Date): boolean {
  try {
    return isDormant(lastActivityAt, days, now);
  } catch {
    return false;
  }
}

export const dynamic = "force-dynamic";
