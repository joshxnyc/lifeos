"use client";

// TaskRow (DESIGN_BRIEF §6): checkbox, title, right-aligned meta, 3px domain
// edge. Swipe right completes, swipe left opens the reschedule sheet; on
// desktop the same two actions appear on hover. Mirrored (Notion) tasks have
// no checkbox and open externally (CONTRACTS ground rule 7).

import { useRef, useState, useTransition } from "react";
import { Check, CalendarClock, ExternalLink, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { PersonAvatar, DOMAIN_EDGE_CLASS } from "@/components/ui/domain";
import { completeTask, reopenTask } from "@/app/(app)/tasks/actions";
import { toast } from "@/components/tasks/toast";
import { DUE_TONE_CLASS, dueTone, formatDueLabel, relativeDayLabel } from "@/components/tasks/format";
import type { TaskView } from "@/components/tasks/types";

const SWIPE_TRIGGER = 72;
const SWIPE_MAX = 140;

export function TaskRow({
  task,
  today,
  showProject = true,
  onEdit,
  onReschedule,
}: {
  task: TaskView;
  today: string;
  showProject?: boolean;
  onEdit: (task: TaskView) => void;
  onReschedule: (task: TaskView) => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [, startTransition] = useTransition();
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"none" | "x" | "y">("none");

  const done = task.status === "done";
  const swipeable = !task.is_mirror && !done;

  function runComplete() {
    if (!swipeable || completing) return;
    setCompleting(true);
    // Fade + collapse for 300ms, then write (DESIGN_BRIEF §3 Motion).
    window.setTimeout(() => {
      startTransition(async () => {
        const res = await completeTask(task.id);
        if (!res.ok) {
          setCompleting(false);
          toast(res.error);
        }
      });
    }, 300);
  }

  function runReopen() {
    startTransition(async () => {
      const res = await reopenTask(task.id);
      if (!res.ok) toast(res.error);
    });
  }

  function onTouchStart(e: React.TouchEvent) {
    if (!swipeable) return;
    const t = e.touches[0];
    if (!t) return;
    start.current = { x: t.clientX, y: t.clientY };
    axis.current = "none";
  }

  function onTouchMove(e: React.TouchEvent) {
    const s = start.current;
    const t = e.touches[0];
    if (!s || !t) return;
    const ddx = t.clientX - s.x;
    const ddy = t.clientY - s.y;
    if (axis.current === "none") {
      if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return;
      axis.current = Math.abs(ddx) > Math.abs(ddy) ? "x" : "y";
    }
    if (axis.current !== "x") return;
    setDragging(true);
    setDx(Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, ddx)));
  }

  function onTouchEnd() {
    const travelled = dx;
    start.current = null;
    axis.current = "none";
    setDragging(false);
    setDx(0);
    if (travelled > SWIPE_TRIGGER) runComplete();
    else if (travelled < -SWIPE_TRIGGER) onReschedule(task);
  }

  const due = formatDueLabel(task.due_date, task.due_time, today);
  const tone = dueTone(task.due_date, today);
  const scheduledOnly = !task.due_date && task.scheduled_date;

  return (
    <li
      className={cn(
        "relative overflow-hidden border-b border-line last:border-b-0",
        completing && "task-completing",
      )}
    >
      {dx !== 0 ? (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center px-4 text-[13px] font-medium text-white",
            dx > 0 ? "justify-start bg-ok" : "justify-end bg-ink-3",
          )}
        >
          {dx > 0 ? "Done" : "Reschedule"}
        </div>
      ) : null}

      <div
        className={cn(
          "group relative flex min-h-11 items-start gap-2 border-l-[3px] bg-paper py-2 pl-2 pr-1",
          DOMAIN_EDGE_CLASS[task.domain_slug],
        )}
        style={{
          transform: dx === 0 ? undefined : `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 150ms ease-out",
          touchAction: "pan-y",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {task.is_mirror ? (
          <span className="flex size-11 shrink-0 items-center justify-center" aria-hidden>
            <span className="flex size-[22px] items-center justify-center rounded-[4px] border border-line font-display text-[12px] leading-none text-ink-2">
              N
            </span>
          </span>
        ) : (
          <button
            type="button"
            aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} done`}
            onClick={done ? runReopen : runComplete}
            className="flex size-11 shrink-0 items-center justify-center"
          >
            <span
              className={cn(
                "flex size-[22px] items-center justify-center rounded-full border transition-colors",
                done ? "border-ok bg-ok text-white" : "border-ink-3",
              )}
            >
              {done ? <Check size={13} strokeWidth={3} /> : null}
            </span>
          </button>
        )}

        <div className="min-w-0 flex-1 py-1.5">
          {task.is_mirror ? (
            <a
              href={task.external_url ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="flex items-start gap-1.5 text-[15px] text-ink"
            >
              <span className="min-w-0 break-words">{task.title}</span>
              <ExternalLink size={13} className="mt-1 shrink-0 text-ink-3" />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => onEdit(task)}
              className={cn(
                "block w-full break-words text-left text-[15px]",
                done ? "text-ink-2 line-through" : "text-ink",
              )}
            >
              {task.title}
            </button>
          )}
        </div>

        <div className="hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 md:flex">
          {swipeable ? (
            <button
              type="button"
              aria-label="Reschedule"
              onClick={() => onReschedule(task)}
              className="flex size-9 items-center justify-center text-ink-2 hover:text-ink"
            >
              <CalendarClock size={16} />
            </button>
          ) : null}
          {task.is_mirror ? null : (
            <button
              type="button"
              aria-label="Edit task"
              onClick={() => onEdit(task)}
              className="flex size-9 items-center justify-center text-ink-2 hover:text-ink"
            >
              <Pencil size={15} />
            </button>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-0.5 py-1.5 pl-1 text-right">
          <div className="flex items-center gap-2">
            {task.priority === 3 ? (
              <span aria-label="High priority" className="size-1.5 rounded-full bg-accent" />
            ) : null}
            {due ? (
              <span className={cn("tabular text-[12px]", DUE_TONE_CLASS[tone])}>{due}</span>
            ) : scheduledOnly && task.scheduled_date ? (
              <span className="tabular text-[12px] text-ink-2">
                Do {relativeDayLabel(task.scheduled_date, today).toLowerCase()}
              </span>
            ) : null}
            {task.person_name ? (
              <PersonAvatar name={task.person_name} slug={task.domain_slug} size={22} />
            ) : null}
          </div>
          {showProject && (task.project_name || task.owner === "them") ? (
            <span className="max-w-[150px] truncate text-[12px] text-ink-2">
              {task.owner === "them" ? "Waiting" : null}
              {task.owner === "them" && task.project_name ? " · " : null}
              {task.project_name}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
