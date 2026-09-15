import Link from "next/link";
import { createClient, currentUserId } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { localDate } from "@/lib/time";
import { PageHeader } from "@/components/ui/page-header";
import { QuickAdd } from "@/components/tasks/quick-add";
import { TaskList } from "@/components/tasks/task-list";
import {
  FILTER_LABEL,
  PAGE_SIZE,
  TaskFilters,
  parseTaskQuery,
  taskHref,
} from "@/components/tasks/task-filters";
import { TASK_SELECT, loadQuickAddContext, toTaskView, toTaskViews } from "@/app/(app)/tasks/queries";
import type { DomainSlug } from "@/lib/types";
import type { TaskView } from "@/components/tasks/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseTaskQuery(params);
  const addParam = params.add;
  const prefill = (Array.isArray(addParam) ? addParam[0] : addParam) ?? "";
  // `/tasks?task=<id>` is the app's task deep link — search results, capture
  // results, the source view and app-created calendar blocks all point here.
  const taskParam = Array.isArray(params.task) ? params.task[0] : params.task;
  const focusId = taskParam && UUID.test(taskParam) ? taskParam : null;

  const supabase = await createClient();
  const userId = await currentUserId();
  const settings = await getSettings(supabase, userId ?? "");
  const today = localDate(new Date(), settings.timezone);

  const { domains, projects, people } = await loadQuickAddContext(supabase);
  const activeDomain = domains.find((d) => d.slug === (query.domain as DomainSlug));

  const base = supabase.from("tasks").select(TASK_SELECT);
  const scoped = activeDomain ? base.eq("domain_id", activeDomain.id) : base;

  const filtered =
    query.filter === "done"
      ? scoped.eq("status", "done")
      : query.filter === "nodate"
        ? scoped.eq("status", "open").is("due_date", null).is("scheduled_date", null)
        : query.filter === "high"
          ? scoped.eq("status", "open").eq("priority", 3)
          : query.filter === "mirrored"
            ? scoped.eq("is_mirror", true)
            : scoped.eq("status", "open");

  const ordered =
    query.sort === "priority"
      ? filtered
          .order("priority", { ascending: false })
          .order("due_date", { ascending: true, nullsFirst: false })
      : query.sort === "recent"
        ? filtered.order("created_at", { ascending: false })
        : filtered
            .order("due_date", { ascending: true, nullsFirst: false })
            .order("priority", { ascending: false });

  // One extra row tells us whether "Load more" is worth showing.
  const { data } = await ordered.range(0, query.limit);
  const rows = toTaskViews(data);
  const hasMore = rows.length > query.limit;
  const tasks = hasMore ? rows.slice(0, query.limit) : rows;

  // The deep-linked task may be filtered out of the list (done, another
  // domain), so it is loaded on its own and handed to the sheet.
  let focusTask: TaskView | null = focusId ? (tasks.find((t) => t.id === focusId) ?? null) : null;
  if (focusId && !focusTask) {
    const { data: one } = await supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("id", focusId)
      .maybeSingle();
    focusTask = one ? toTaskView(one) : null;
  }
  // Mirrored Notion rows are read-only everywhere (CONTRACTS rule 7): never
  // open the edit sheet on one.
  if (focusTask?.is_mirror) focusTask = null;

  const subtitle =
    query.filter === "done"
      ? "Completed tasks"
      : `${tasks.length}${hasMore ? "+" : ""} ${FILTER_LABEL[query.filter].toLowerCase()}`;

  return (
    <>
      <PageHeader title="Tasks" subtitle={subtitle} />

      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-col gap-3 bg-paper px-4 pb-3 pt-1 md:-mx-8 md:px-8">
        <QuickAdd
          domains={domains}
          projects={projects}
          people={people}
          today={today}
          defaultDomainId={activeDomain?.id}
          initialValue={prefill}
          autoFocus={Boolean(prefill)}
        />
        <TaskFilters domains={domains} query={query} />
      </div>

      <TaskList
        sections={[{ key: "all", tasks }]}
        today={today}
        domains={domains}
        projects={projects}
        focusTask={focusTask}
        emptyLine={
          query.filter === "done"
            ? "Nothing completed here yet."
            : "No tasks match this filter."
        }
        emptyAction={
          <Link href={taskHref(query, { domain: "all", filter: "open" })} className="text-[14px] text-accent">
            Show all open tasks
          </Link>
        }
      />

      {hasMore ? (
        <Link
          href={taskHref(query, { limit: query.limit + PAGE_SIZE })}
          scroll={false}
          className="inline-flex h-11 items-center text-[14px] text-accent"
        >
          Load more
        </Link>
      ) : null}
    </>
  );
}
