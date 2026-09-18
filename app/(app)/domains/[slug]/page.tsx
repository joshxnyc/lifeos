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
      {/* Canvas 2f: the domain colour is a short 3px rule above the title,
          never a fill behind it. */}
      <span
        aria-hidden
        className={cn("mt-6 block h-[3px] w-10 rounded-[2px]", DOMAIN_COLOR_CLASS[domain.slug])}
      />
      <header className="mt-3 mb-6 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="display-title">{domain.name}</h1>
          <p className="tabular mt-1 text-[13px] text-ink-2">
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
          <p className="section-label mb-2.5">Projects and areas</p>
          {/* Canvas 2f: each project is its own hairline card, two columns. */}
          <ul className="flex flex-col gap-2">
            {projects.map((p) => {
              const dormant =
                p.status === "active" && safeDormant(p.last_activity_at, settings.dormancy_days, now);
              const nextDue = nextDueFor(p.id);
              return (
                <li key={p.id}>
                  <Link
                    href={`/projects/${p.id}`}
                    className="grid min-h-11 grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded-card border border-line px-3.5 py-3"
                  >
                    <span className="min-w-0 truncate text-[15px] font-medium text-ink">{p.name}</span>
                    <span className="tabular shrink-0 text-right text-[12px] text-ink-2">
                      {p.kind === "area" ? "Area" : "Project"}
                      {p.status !== "active" ? " · Parked" : ""} · {openCountFor(p.id)} open
                    </span>
                    <span className="min-w-0 truncate text-[13px] text-ink-2">
                      {nextDue ? `Next due ${relativeDayLabel(nextDue, today)} · ` : ""}
                      active {relativeDayLabel(localDate(new Date(p.last_activity_at), tz), today).toLowerCase()}
                    </span>
                    <span className="tabular shrink-0 text-right text-[12px]">
                      {dormant ? (
                        <span className="inline-flex items-center gap-1.5 text-warn">
                          <span className="size-1.5 rounded-full bg-warn" aria-hidden />
                          Dormant
                        </span>
                      ) : null}
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
