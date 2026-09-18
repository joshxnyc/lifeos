// Server-rendered filter controls for /tasks — every control is a link, so the
// list stays server-rendered and paginated.

import Link from "next/link";
import { cn } from "@/lib/utils";
import { DOMAIN_COLOR_CLASS } from "@/components/ui/domain";
import type { DomainOption } from "@/components/tasks/types";

export type TaskFilter = "open" | "done" | "nodate" | "high" | "mirrored";
export type TaskSort = "due" | "priority" | "recent";

export interface TaskQuery {
  domain: string; // domain slug or "all"
  filter: TaskFilter;
  sort: TaskSort;
  limit: number;
}

export const FILTER_LABEL: Record<TaskFilter, string> = {
  open: "Open",
  done: "Done",
  nodate: "No date",
  high: "High",
  mirrored: "Mirrored",
};

export const SORT_LABEL: Record<TaskSort, string> = {
  due: "Due",
  priority: "Priority",
  recent: "Recent",
};

export const PAGE_SIZE = 50;

export function parseTaskQuery(params: Record<string, string | string[] | undefined>): TaskQuery {
  const read = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const filter = read("filter");
  const sort = read("sort");
  const limit = Number(read("limit"));
  return {
    domain: read("domain") ?? "all",
    filter: (filter && filter in FILTER_LABEL ? filter : "open") as TaskFilter,
    sort: (sort && sort in SORT_LABEL ? sort : "due") as TaskSort,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : PAGE_SIZE,
  };
}

export function taskHref(query: TaskQuery, patch: Partial<TaskQuery>): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.domain !== "all") params.set("domain", next.domain);
  if (next.filter !== "open") params.set("filter", next.filter);
  if (next.sort !== "due") params.set("sort", next.sort);
  if (next.limit !== PAGE_SIZE) params.set("limit", String(next.limit));
  const qs = params.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}

function Pill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        // Canvas 1f: the chosen filter is an ink fill; the rest are hairlines.
        "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px]",
        active ? "border-ink bg-ink text-paper" : "border-line text-ink",
      )}
    >
      {children}
    </Link>
  );
}

export function TaskFilters({ domains, query }: { domains: DomainOption[]; query: TaskQuery }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Pill href={taskHref(query, { domain: "all", limit: PAGE_SIZE })} active={query.domain === "all"}>
          All
        </Pill>
        {domains.map((d) => (
          <Pill
            key={d.id}
            href={taskHref(query, { domain: d.slug, limit: PAGE_SIZE })}
            active={query.domain === d.slug}
          >
            <span className={cn("size-1.5 rounded-full", DOMAIN_COLOR_CLASS[d.slug])} />
            {d.name}
          </Pill>
        ))}
      </div>

      <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
        {(Object.keys(FILTER_LABEL) as TaskFilter[]).map((f) => (
          <Pill
            key={f}
            href={taskHref(query, { filter: f, limit: PAGE_SIZE })}
            active={query.filter === f}
          >
            {FILTER_LABEL[f]}
          </Pill>
        ))}
        <span className="ml-auto hidden shrink-0 items-center gap-1.5 md:flex">
          <span className="section-label">Sort</span>
          {(Object.keys(SORT_LABEL) as TaskSort[]).map((s) => (
            <Pill key={s} href={taskHref(query, { sort: s, limit: PAGE_SIZE })} active={query.sort === s}>
              {SORT_LABEL[s]}
            </Pill>
          ))}
        </span>
      </div>

      <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 md:hidden">
        <span className="section-label shrink-0">Sort</span>
        {(Object.keys(SORT_LABEL) as TaskSort[]).map((s) => (
          <Pill key={s} href={taskHref(query, { sort: s, limit: PAGE_SIZE })} active={query.sort === s}>
            {SORT_LABEL[s]}
          </Pill>
        ))}
      </div>
    </div>
  );
}
