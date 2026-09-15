"use client";

// Edit a task. There is no /tasks/[id] route in the route map, so this sheet
// is the task detail: the full Phase 1 CRUD surface plus Drop and Delete.

import { useEffect, useState, useTransition } from "react";
import { deleteTask, dropTask, updateTask } from "@/app/(app)/tasks/actions";
import { Sheet } from "@/components/tasks/sheet";
import { toast } from "@/components/tasks/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DomainOption, ProjectOption, TaskView } from "@/components/tasks/types";

const RECURRENCE_PRESETS: Array<{ value: string; label: string }> = [
  { value: "", label: "Does not repeat" },
  { value: "FREQ=DAILY", label: "Every day" },
  { value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", label: "Weekdays" },
  { value: "FREQ=WEEKLY", label: "Every week" },
  { value: "FREQ=MONTHLY", label: "Every month" },
];

const field =
  "h-11 w-full rounded-card border border-line bg-paper-2 px-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent";

export function TaskSheet({
  task,
  domains,
  projects,
  onClose,
}: {
  task: TaskView | null;
  domains: DomainOption[];
  projects: ProjectOption[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [domainId, setDomainId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState("0");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [customRule, setCustomRule] = useState("");
  const [dropping, setDropping] = useState(false);
  const [dropReason, setDropReason] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setBody(task.body_md ?? "");
    setDomainId(task.domain_id);
    setProjectId(task.project_id ?? "");
    setPriority(String(task.priority));
    setDueDate(task.due_date ?? "");
    setDueTime(task.due_time ? task.due_time.slice(0, 5) : "");
    setScheduledDate(task.scheduled_date ?? "");
    const rule = task.recurrence_rule ?? "";
    const known = RECURRENCE_PRESETS.some((p) => p.value === rule);
    setRecurrence(known ? rule : "custom");
    setCustomRule(known ? "" : rule);
    setDropping(false);
    setDropReason("");
  }, [task]);

  if (!task) return null;

  const id = task.id;
  const visibleProjects = projects.filter((p) => p.domain_id === domainId);

  function save() {
    startTransition(async () => {
      const res = await updateTask(id, {
        title,
        body_md: body,
        domain_id: domainId,
        project_id: projectId || null,
        priority: Number(priority) as 0 | 1 | 2 | 3,
        due_date: dueDate || null,
        due_time: dueTime || null,
        scheduled_date: scheduledDate || null,
        recurrence_rule: recurrence === "custom" ? customRule || null : recurrence || null,
      });
      if (!res.ok) toast(res.error);
      else {
        toast("Task saved");
        onClose();
      }
    });
  }

  function drop() {
    startTransition(async () => {
      const res = await dropTask(id, dropReason);
      if (!res.ok) toast(res.error);
      else {
        toast("Task dropped");
        onClose();
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteTask(id);
      if (!res.ok) toast(res.error);
      else {
        toast("Task deleted");
        onClose();
      }
    });
  }

  return (
    <Sheet open onClose={onClose} title="Task">
      <div className="flex flex-col gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Title"
          className={field}
        />

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Notes"
          rows={3}
          placeholder="Notes"
          className="w-full rounded-card border border-line bg-paper-2 px-3 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        />

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="section-label">Domain</span>
            <select
              value={domainId}
              onChange={(e) => {
                setDomainId(e.target.value);
                setProjectId("");
              }}
              className={field}
            >
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="section-label">Project</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={field}
            >
              <option value="">None</option>
              {visibleProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="section-label">Due</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={field}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="section-label">Time</span>
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className={field}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="section-label">Do on</span>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className={field}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="section-label">Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={field}>
              <option value="0">None</option>
              <option value="1">Low</option>
              <option value="2">Medium</option>
              <option value="3">High</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="section-label">Repeat</span>
          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
            className={field}
          >
            {RECURRENCE_PRESETS.map((p) => (
              <option key={p.value || "none"} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom rule</option>
          </select>
        </label>

        {recurrence === "custom" ? (
          <input
            value={customRule}
            onChange={(e) => setCustomRule(e.target.value)}
            placeholder="FREQ=WEEKLY;BYDAY=TU"
            aria-label="Recurrence rule"
            className={cn(field, "font-mono text-[13px]")}
          />
        ) : null}

        {dropping ? (
          <div className="flex flex-col gap-2 rounded-card border border-line p-3">
            <span className="section-label">Why are you dropping this?</span>
            <input
              value={dropReason}
              onChange={(e) => setDropReason(e.target.value)}
              placeholder="One line"
              className={field}
            />
            <div className="flex gap-2">
              <Button variant="danger" onClick={drop} disabled={pending}>
                Drop it
              </Button>
              <Button variant="ghost" onClick={() => setDropping(false)}>
                Keep
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="primary" onClick={save} disabled={pending}>
              Save
            </Button>
            {!dropping ? (
              <Button variant="ghost" onClick={() => setDropping(true)}>
                Drop
              </Button>
            ) : null}
          </div>
          <Button variant="ghost" className="text-danger" onClick={remove} disabled={pending}>
            Delete
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
