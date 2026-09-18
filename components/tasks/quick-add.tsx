"use client";

// Quick-add field (SPEC §9). Parsing is pure and lives in lib/domain/quick-add
// (workstream D); this component only renders the live preview and writes.
//
// Two ways out of the same field: Add (Enter) hands the raw sentence to the
// capture pipeline, which splits several to-dos and reads dates, priorities
// and people out of plain English. "Add as typed" (⌘⏎) is the instant,
// deterministic token parse for when the AI round-trip isn't wanted.

import { useMemo, useRef, useState, useTransition } from "react";
import { parseQuickAdd, type QuickAddResult } from "@/lib/domain/quick-add";
import { createTask } from "@/app/(app)/tasks/actions";
import { toast } from "@/components/tasks/toast";
import { useSmartAdd } from "@/components/capture/use-smart-add";
import { FilingIndicator } from "@/components/capture/filing-indicator";
import { formatClock, relativeDayLabel, PRIORITY_LABEL } from "@/components/tasks/format";
import { cn } from "@/lib/utils";
import type { DomainOption, PersonOption, ProjectOption } from "@/components/tasks/types";

export type QuickAddParsed = QuickAddResult;

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
    return parseQuickAdd(input, ctx);
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
          className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[13px] text-ink"
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
  showSmartHint = false,
  placeholder = 'Add a task — "Make chicken katsu today, high priority, before noon"',
}: {
  domains: DomainOption[];
  projects: ProjectOption[];
  people: PersonOption[];
  today: string;
  defaultDomainId?: string;
  defaultProjectId?: string;
  initialValue?: string;
  autoFocus?: boolean;
  /** One line under the field explaining the smart Add. On the Tasks screen only. */
  showSmartHint?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();
  const { smartAdd, working } = useSmartAdd();
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

  function submitSmart() {
    const raw = value.trim();
    if (!raw || working) return;
    setValue("");
    void smartAdd(raw).then((filed) => {
      // Nothing was created: hand the sentence back rather than lose it.
      if (!filed) setValue(raw);
      inputRef.current?.focus();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter is the smart path; ⌘⏎ is the instant deterministic parse.
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.metaKey || e.ctrlKey) submit();
              else submitSmart();
            }
            if (e.key === "Escape") setValue("");
          }}
          placeholder={placeholder}
          aria-label="Quick add a task"
          className="h-11 min-w-0 flex-1 rounded-card bg-paper-2 px-3.5 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:ring-1 focus:ring-accent"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!parsed.title.trim() || pending}
          aria-label="Add exactly as typed, without AI"
          className="h-11 shrink-0 whitespace-nowrap px-2 text-[14px] font-medium text-accent disabled:opacity-40"
        >
          As typed
        </button>
        <button
          type="button"
          onClick={submitSmart}
          disabled={!value.trim() || working}
          aria-label="Add task"
          className="h-11 shrink-0 rounded-full bg-accent px-4 text-[14px] font-medium text-paper disabled:opacity-40"
        >
          {working ? <FilingIndicator dotClassName="bg-paper" /> : "Add"}
        </button>
      </div>
      {value.trim() ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2">
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
      {showSmartHint ? (
        <p className="text-[13px] text-ink-2">
          Add understands plain English: several to-dos, dates, priorities and people. ⌘⏎ adds
          exactly as typed.
        </p>
      ) : null}
    </div>
  );
}
