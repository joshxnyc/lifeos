"use client";

// Renders one or more labelled task sections and owns the two sheets every
// row can open (reschedule, edit), so there is a single instance of each.

import { useState } from "react";
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
}: {
  sections: TaskSection[];
  today: string;
  domains: DomainOption[];
  projects: ProjectOption[];
  showProject?: boolean;
  emptyLine?: string;
  emptyAction?: React.ReactNode;
}) {
  const [rescheduling, setRescheduling] = useState<TaskView | null>(null);
  const [editing, setEditing] = useState<TaskView | null>(null);

  const filled = sections.filter((s) => s.tasks.length > 0);

  if (filled.length === 0) {
    return emptyLine ? <EmptyState line={emptyLine} action={emptyAction} /> : null;
  }

  return (
    <>
      {filled.map((section) => (
        <section key={section.key} className="mb-7">
          {section.label ? (
            <div className="mb-1 flex items-baseline justify-between">
              <h2
                className={cn("section-label", section.tone === "danger" && "text-danger")}
              >
                {section.label}
              </h2>
              <span className="tabular text-[12px] text-ink-2">{section.tasks.length}</span>
            </div>
          ) : null}
          <ul className="border-t border-line">
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
