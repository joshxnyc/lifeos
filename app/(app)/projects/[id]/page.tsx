import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient, currentUserId } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { localDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DomainChip, DOMAIN_COLOR_CLASS, NotionGlyph } from "@/components/ui/domain";
import { TaskList } from "@/components/tasks/task-list";
import { QuickAdd } from "@/components/tasks/quick-add";
import { ProjectActions } from "@/components/tasks/project-form";
import { daysBetween, formatShortDate, relativeDayLabel } from "@/components/tasks/format";
import { TASK_SELECT, loadQuickAddContext, toTaskViews } from "@/app/(app)/tasks/queries";
import type { Domain, Note, Project, SourceItem, Task } from "@/lib/types";

type Tab = "tasks" | "notes" | "sources" | "activity";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "tasks", label: "Tasks" },
  { key: "notes", label: "Notes" },
  { key: "sources", label: "Sources" },
  { key: "activity", label: "Activity" },
];

const KIND_SOURCE_LABEL: Record<string, string> = {
  email_thread: "Email",
  calendar_event: "Event",
  notion_page: "Notion",
  granola_note: "Meeting",
};

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : "tasks";

  const supabase = await createClient();
  const userId = await currentUserId();
  const settings = await getSettings(supabase, userId ?? "");
  const tz = settings.timezone;
  const today = localDate(new Date(), tz);

  const { data: projectRow } = await supabase
    .from("projects")
    .select("*, domains(id, slug, name)")
    .eq("id", id)
    .maybeSingle();
  const project = projectRow as (Project & { domains: Pick<Domain, "id" | "slug" | "name"> | null }) | null;
  if (!project) notFound();

  const [{ domains, projects, people }, { data: taskRows }] = await Promise.all([
    loadQuickAddContext(supabase),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("project_id", id)
      .order("status")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(300),
  ]);

  const tasks = toTaskViews(taskRows);
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
    .slice(0, 20);

  const targetDelta = project.target_date ? daysBetween(today, project.target_date) : null;

  return (
    <>
      <header className="pt-6">
        {project.notion_url ? (
          <div className="flex justify-end">
            <a
              href={project.notion_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-[15px] text-accent"
            >
              Open in Notion ↗
            </a>
          </div>
        ) : null}

        {/* Canvas 1g: a short 3px rule in the domain colour heads the page. */}
        {project.domains ? (
          <span
            aria-hidden
            className={cn(
              "mb-3 block h-[3px] w-10 rounded-[2px]",
              DOMAIN_COLOR_CLASS[project.domains.slug],
            )}
          />
        ) : null}

        <h1 className="display-title">{project.name}</h1>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {project.domains ? (
            <DomainChip slug={project.domains.slug} name={project.domains.name} />
          ) : null}
          <span className="rounded-full bg-paper-2 px-2.5 py-0.5 text-[13px] text-ink">
            {project.kind === "area" ? "Area" : "Project"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-2 px-2.5 py-0.5 text-[13px] text-ink">
            <span
              aria-hidden
              className={cn(
                "size-[7px] shrink-0 rounded-full",
                project.status === "active" ? "bg-ok" : "bg-warn",
              )}
            />
            {project.status === "active" ? "Active" : project.status === "parked" ? "Parked" : "Closed"}
          </span>
          {project.notion_url ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-2 px-2.5 py-0.5 text-[13px] text-ink">
              <NotionGlyph />
              Mirrored
            </span>
          ) : null}
        </div>

        {/* Canvas 1g: days to target lead as a display number. */}
        {project.target_date ? (
          <div className="mt-4 flex items-baseline gap-2.5">
            <span className="display-number">
              {targetDelta === null ? "—" : Math.abs(targetDelta)}
            </span>
            <span className="text-[13px] text-ink-2">
              {targetDelta === null
                ? "target"
                : targetDelta === 0
                  ? "days to target · today"
                  : targetDelta > 0
                    ? `days to target · ${formatShortDate(project.target_date, today)}`
                    : `days over target · ${formatShortDate(project.target_date, today)}`}
            </span>
          </div>
        ) : null}

        {project.description ? (
          <div className="prose-project mt-3.5 text-[15px] leading-relaxed text-ink-2 [&_a]:text-accent [&_h1]:font-display [&_h2]:font-display [&_li]:my-0.5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{project.description}</ReactMarkdown>
          </div>
        ) : null}

        <div className="mt-3">
          <ProjectActions project={project} domains={domains} />
        </div>
      </header>

      <nav className="mt-6 flex gap-1.5 border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/projects/${id}?tab=${t.key}`}
            scroll={false}
            className={cn(
              "-mb-px inline-flex h-11 items-center border-b-2 px-2 text-[14px]",
              tab === t.key ? "border-ink font-medium text-ink" : "border-transparent text-ink-2",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mt-5">
        {tab === "tasks" ? (
          <>
            {project.notion_url ? null : (
              <div className="mb-5">
                <QuickAdd
                  domains={domains}
                  projects={projects}
                  people={people}
                  today={today}
                  defaultDomainId={project.domain_id}
                  defaultProjectId={project.id}
                  placeholder="Add a task to this project"
                />
              </div>
            )}
            <TaskList
              sections={[
                { key: "open", label: "Open", tasks: open },
                { key: "done", label: "Recently done", tasks: done },
              ]}
              today={today}
              domains={domains}
              projects={projects}
              showProject={false}
              emptyLine="No tasks here yet."
            />
          </>
        ) : null}

        {tab === "notes" ? <NotesTab supabase={supabase} projectId={id} today={today} tz={tz} /> : null}
        {tab === "sources" ? (
          <SourcesTab supabase={supabase} tasks={tasks} today={today} tz={tz} />
        ) : null}
        {tab === "activity" ? <ActivityTab tasks={tasks} today={today} tz={tz} /> : null}
      </div>
    </>
  );
}

async function NotesTab({
  supabase,
  projectId,
  today,
  tz,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  projectId: string;
  today: string;
  tz: string;
}) {
  const { data } = await supabase
    .from("notes")
    .select("id, title, updated_at, pinned")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(50);
  const notes = (data ?? []) as Array<Pick<Note, "id" | "title" | "updated_at" | "pinned">>;

  if (notes.length === 0) {
    return <p className="py-6 text-[14px] text-ink-2">No notes linked to this project.</p>;
  }

  return (
    <ul className="border-t border-line">
      {notes.map((n) => (
        <li key={n.id} className="border-b border-line last:border-b-0">
          <Link href={`/notes/${n.id}`} className="flex min-h-11 items-center justify-between gap-3 py-2.5">
            <span className="min-w-0 break-words text-[15px] text-ink">{n.title || "Untitled"}</span>
            <span className="tabular shrink-0 text-[12px] text-ink-2">
              {relativeDayLabel(localDate(new Date(n.updated_at), tz), today)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function SourcesTab({
  supabase,
  tasks,
  today,
  tz,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  tasks: Array<Pick<Task, "source_item_id">>;
  today: string;
  tz: string;
}) {
  const ids = Array.from(
    new Set(tasks.map((t) => t.source_item_id).filter((v): v is string => Boolean(v))),
  );
  if (ids.length === 0) {
    return (
      <p className="py-6 text-[14px] text-ink-2">
        Nothing from email, meetings or Notion is linked to this project yet.
      </p>
    );
  }

  const { data } = await supabase
    .from("source_items")
    .select("id, kind, title, occurred_at, provider")
    .in("id", ids)
    .order("occurred_at", { ascending: false })
    .limit(50);
  const items = (data ?? []) as Array<
    Pick<SourceItem, "id" | "kind" | "title" | "occurred_at" | "provider">
  >;

  return (
    <ul className="border-t border-line">
      {items.map((s) => (
        <li key={s.id} className="border-b border-line last:border-b-0">
          <Link href={`/source/${s.id}`} className="flex min-h-11 items-center justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="section-label">{KIND_SOURCE_LABEL[s.kind] ?? s.provider}</span>
              <span className="block break-words text-[15px] text-ink">{s.title || "Untitled"}</span>
            </span>
            {s.occurred_at ? (
              <span className="tabular shrink-0 text-[12px] text-ink-2">
                {relativeDayLabel(localDate(new Date(s.occurred_at), tz), today)}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ActivityTab({
  tasks,
  today,
  tz,
}: {
  tasks: Array<Pick<Task, "id" | "title" | "created_at" | "completed_at" | "status">>;
  today: string;
  tz: string;
}) {
  const entries = tasks
    .map((t) => ({
      id: t.id,
      title: t.title,
      at: t.completed_at ?? t.created_at,
      label: t.completed_at ? "Completed" : t.status === "dropped" ? "Dropped" : "Created",
    }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 30);

  if (entries.length === 0) {
    return <p className="py-6 text-[14px] text-ink-2">No activity yet.</p>;
  }

  return (
    <ul className="border-t border-line">
      {entries.map((e) => (
        <li key={`${e.id}-${e.label}`} className="flex items-start justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
          <span className="min-w-0">
            <span className="section-label">{e.label}</span>
            <span className="block break-words text-[15px] text-ink">{e.title}</span>
          </span>
          <span className="tabular shrink-0 text-[12px] text-ink-2">
            {relativeDayLabel(localDate(new Date(e.at), tz), today)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export const dynamic = "force-dynamic";
