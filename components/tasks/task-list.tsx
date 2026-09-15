"use client";

// Renders one or more labelled task sections and owns the two sheets every
// row can open (reschedule, edit), so there is a single instance of each.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { TaskRow } from "@/components/tasks/task-row";
import { RescheduleSheet } from "@/components/tasks/reschedule-sheet";
import { TaskSheet } from "@/components/tasks/task-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import type { DomainOption, ProjectOption, TaskView } from "@/components/tasks/types";

export interface TaskSection {
  key: string;
  label?: string;
  tone?: "danger" | "default";
  tasks: TaskView[];
}

export function TaskList({
  sections,
  today,
  domains,
  projects,
  showProject = true,
  emptyLine,
  emptyAction,
  focusTask = null,
}: {
  sections: TaskSection[];
  today: string;
  domains: DomainOption[];
  projects: ProjectOption[];
  showProject?: boolean;
  emptyLine?: string;
  emptyAction?: React.ReactNode;
  /** Deep link target (`/tasks?task=…`): opens straight into the edit sheet. */
  focusTask?: TaskView | null;
}) {
  const [rescheduling, setRescheduling] = useState<TaskView | null>(null);
  const [editing, setEditing] = useState<TaskView | null>(focusTask);

  const focusId = focusTask?.id ?? null;
  useEffect(() => {
    if (focusTask) setEditing(focusTask);
    // Re-open only when the deep link itself changes, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const filled = sections.filter((s) => s.tasks.length > 0);

  return (
    <>
      {filled.length === 0 && emptyLine ? (
        <EmptyState line={emptyLine} action={emptyAction} />
      ) : null}

      {filled.map((section) => (
        <section key={section.key} className="mb-6">
          {section.label ? (
            // Canvas: one line, count appended — "Overdue · 2".
            <h2 className={cn("section-label", section.tone === "danger" && "text-danger")}>
              {section.label} · <span className="tabular">{section.tasks.length}</span>
            </h2>
          ) : null}
          <ul className="mt-1.5">
            {section.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                today={today}
                showProject={showProject}
                onEdit={setEditing}
                onReschedule={setRescheduling}
              />
            ))}
          </ul>
        </section>
      ))}

      <RescheduleSheet task={rescheduling} today={today} onClose={() => setRescheduling(null)} />
      <TaskSheet
        task={editing}
        domains={domains}
        projects={projects}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
