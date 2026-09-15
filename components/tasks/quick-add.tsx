"use client";

// Quick-add field (SPEC §9). Parsing is pure and lives in lib/domain/quick-add
// (workstream D); this component only renders the live preview and writes.

import { useMemo, useRef, useState, useTransition } from "react";
import { parseQuickAdd } from "@/lib/domain/quick-add";
import { createTask } from "@/app/(app)/tasks/actions";
import { toast } from "@/components/tasks/toast";
import { formatClock, relativeDayLabel, PRIORITY_LABEL } from "@/components/tasks/format";
import { cn } from "@/lib/utils";
import type { DomainOption, PersonOption, ProjectOption } from "@/components/tasks/types";

export interface QuickAddParsed {
  title: string;
  domain_id?: string;
  project_id?: string;
  person_id?: string;
  priority?: 0 | 1 | 2 | 3;
  due_date?: string;
  due_time?: string;
  scheduled_date?: string;
  tokens: Array<{ raw: string; kind: "domain" | "project" | "person" | "priority" | "due" | "scheduled" }>;
}

export function parseSafely(
  input: string,
  ctx: {
    domains: DomainOption[];
    projects: ProjectOption[];
    people: PersonOption[];
    today: string;
  },
): QuickAddParsed {
  try {
    return parseQuickAdd(input, ctx) as QuickAddParsed;
  } catch {
    return { title: input.trim(), tokens: [] };
  }
}

export function ParsedChips({
  parsed,
  domains,
  projects,
  people,
  today,
  className,
}: {
  parsed: QuickAddParsed;
  domains: DomainOption[];
  projects: ProjectOption[];
  people: PersonOption[];
  today: string;
  className?: string;
}) {
  const chips: string[] = [];
  const domain = domains.find((d) => d.id === parsed.domain_id);
  const project = projects.find((p) => p.id === parsed.project_id);
  const person = people.find((p) => p.id === parsed.person_id);
  if (domain) chips.push(domain.name);
  if (project) chips.push(project.name);
  if (person) chips.push(person.name);
  if (parsed.priority) chips.push(`${PRIORITY_LABEL[parsed.priority]} priority`);
  if (parsed.due_date) {
    const clock = formatClock(parsed.due_time ?? null);
    chips.push(`Due ${relativeDayLabel(parsed.due_date, today).toLowerCase()}${clock ? ` ${clock}` : ""}`);
  }
  if (parsed.scheduled_date) {
    chips.push(`Do ${relativeDayLabel(parsed.scheduled_date, today).toLowerCase()}`);
  }

  if (chips.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-full bg-accent-soft px-2 py-0.5 text-[12px] text-ink"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

export function QuickAdd({
  domains,
  projects,
  people,
  today,
  defaultDomainId,
  defaultProjectId,
  initialValue = "",
  autoFocus = false,
  placeholder = 'Add a task — "Send memo to Bernhard fri #tarifa !high"',
}: {
  domains: DomainOption[];
  projects: ProjectOption[];
  people: PersonOption[];
  today: string;
  defaultDomainId?: string;
  defaultProjectId?: string;
  initialValue?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(
    () => parseSafely(value, { domains, projects, people, today }),
    [value, domains, projects, people, today],
  );

  function submit() {
    const title = parsed.title.trim();
    if (!title || pending) return;
    const project = projects.find((p) => p.id === parsed.project_id);
    const domainId = parsed.domain_id ?? project?.domain_id ?? defaultDomainId;
    setValue("");
    startTransition(async () => {
      const res = await createTask({
        title,
        domain_id: domainId,
        project_id: parsed.project_id ?? defaultProjectId ?? null,
        person_id: parsed.person_id ?? null,
        priority: parsed.priority,
        due_date: parsed.due_date ?? null,
        due_time: parsed.due_time ?? null,
        scheduled_date: parsed.scheduled_date ?? null,
      });
      if (!res.ok) {
        toast(res.error);
        setValue(title);
      } else {
        toast("Task added");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") setValue("");
          }}
          placeholder={placeholder}
          aria-label="Quick add a task"
          className="h-11 min-w-0 flex-1 rounded-card border border-line bg-paper-2 px-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!parsed.title.trim() || pending}
          className="h-11 shrink-0 rounded-card bg-accent px-4 text-[14px] font-medium text-white disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {value.trim() ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
          <span className="truncate">{parsed.title || "…"}</span>
          <ParsedChips
            parsed={parsed}
            domains={domains}
            projects={projects}
            people={people}
            today={today}
          />
        </div>
      ) : null}
    </div>
  );
}
