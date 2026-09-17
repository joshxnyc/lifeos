"use client";

// TaskRow (DESIGN_BRIEF §6): checkbox, title, right-aligned meta, 3px domain
// edge. Swipe right completes, swipe left opens the reschedule sheet; on
// desktop the same two actions appear on hover. Mirrored (Notion) tasks show
// an inert checkbox and open externally (CONTRACTS ground rule 7).

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, CalendarClock, ExternalLink, Pencil } from "lucide-react";
import { cn, safeHttpUrl } from "@/lib/utils";
import { PersonAvatar, DOMAIN_EDGE_CLASS, NotionGlyph } from "@/components/ui/domain";
import { completeTask, reopenTask, undoCompleteTask } from "@/app/(app)/tasks/actions";
import { toast } from "@/components/tasks/toast";
import { DUE_TONE_CLASS, dueTone, formatDueLabel, relativeDayLabel } from "@/components/tasks/format";
import type { TaskView } from "@/components/tasks/types";

const SWIPE_TRIGGER = 72;
const SWIPE_MAX = 140;

export function TaskRow({
  task,
  today,
  showProject = true,
  focused = false,
  onEdit,
  onReschedule,
  registerComplete,
}: {
  task: TaskView;
  today: string;
  showProject?: boolean;
  /** Keyboard roving focus (j/k in TaskList) rests on this row. */
  focused?: boolean;
  onEdit: (task: TaskView) => void;
  onReschedule: (task: TaskView) => void;
  /** Lets TaskList trigger this row's complete (with animation) from the keyboard. */
  registerComplete?: (id: string, run: (() => void) | null) => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [, startTransition] = useTransition();
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"none" | "x" | "y">("none");

  const done = task.status === "done";
  const swipeable = !task.is_mirror && !done;
  // Mirror links come from Notion; anything not http(s) renders as plain text.
  const mirrorUrl = safeHttpUrl(task.external_url);

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
          return;
        }
        // Undo reopens the task and removes the recurrence occurrence the
        // complete just spawned (the action verifies it is still untouched).
        const spawnedId = res.spawnedId ?? null;
        toast("Done", {
          label: "Undo",
          onPress: () => {
            void undoCompleteTask(task.id, spawnedId).then((undo) => {
              if (!undo.ok) toast(undo.error);
              else setCompleting(false);
            });
          },
        });
      });
    }, 300);
  }

  // Register the animated complete path so TaskList's keyboard hook ("x")
  // goes through the exact same code as a checkbox tap. No dependency array:
  // runComplete closes over fresh state each render, and the map set is cheap.
  useEffect(() => {
    registerComplete?.(task.id, swipeable ? runComplete : null);
    return () => registerComplete?.(task.id, null);
  });

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
      data-task-id={task.id}
      className={cn(
        "relative overflow-hidden border-b border-line",
        completing && "task-completing",
      )}
    >
      {dx !== 0 ? (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center px-4 text-[14px] font-medium text-paper",
            dx > 0 ? "justify-start bg-ok" : "justify-end bg-ink-3",
          )}
        >
          {dx > 0 ? "Done" : "Reschedule"}
        </div>
      ) : null}

      <div
        className={cn(
          "group relative flex min-h-11 items-center gap-1 border-l-[3px] py-1 pr-1",
          // Keyboard focus reads as a paper-2 wash, like the palette rows.
          focused ? "bg-paper-2" : "bg-paper",
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
        {/* Canvas: a 20px rounded-6 square, hollow ink-3 when open, filled ok
            with a tick when done. Mirrored rows carry the same shape but no
            control — they are completed in Notion. */}
        {task.is_mirror ? (
          <span className="flex size-11 shrink-0 items-center justify-center" aria-hidden>
            <span className="size-5 rounded-[6px] border-[1.5px] border-ink-3 opacity-50" />
          </span>
        ) : (
          <button
            type="button"
            aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} done`}
            onClick={done ? runReopen : runComplete}
            className="group/check flex size-11 shrink-0 items-center justify-center"
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-[6px] border-[1.5px] transition-[color,background-color,border-color,transform] duration-150 group-active/check:scale-90",
                done ? "border-ok bg-ok text-paper" : "border-ink-3",
              )}
            >
              {done ? <Check size={13} strokeWidth={3} /> : null}
            </span>
          </button>
        )}

        <div className="min-w-0 flex-1 py-1.5">
          {task.is_mirror ? (
            mirrorUrl ? (
              <a
                href={mirrorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[15px] text-ink"
              >
                <span className="min-w-0 break-words">{task.title}</span>
                <NotionGlyph />
                <ExternalLink size={13} className="shrink-0 text-ink-3" />
              </a>
            ) : (
              <span className="flex items-center gap-1.5 text-[15px] text-ink">
                <span className="min-w-0 break-words">{task.title}</span>
                <NotionGlyph />
              </span>
            )
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
              className="flex size-11 items-center justify-center text-ink-2 hover:text-ink"
            >
              <CalendarClock size={16} />
            </button>
          ) : null}
          {task.is_mirror ? null : (
            <button
              type="button"
              aria-label="Edit task"
              onClick={() => onEdit(task)}
              className="flex size-11 items-center justify-center text-ink-2 hover:text-ink"
            >
              <Pencil size={15} />
            </button>
          )}
        </div>

        {/* Canvas meta: one 13px ink-2 row — project or avatar, then the due
            date in warn (today) or danger (overdue). */}
        <div className="flex shrink-0 items-center gap-2 pl-1 text-[13px] text-ink-2">
          {task.priority === 3 ? (
            <span aria-label="High priority" className="size-1.5 rounded-full bg-accent" />
          ) : null}
          {showProject && (task.project_name || task.owner === "them") ? (
            <span className="hidden max-w-[150px] truncate sm:inline">
              {task.owner === "them" ? "Waiting" : null}
              {task.owner === "them" && task.project_name ? " · " : null}
              {task.project_name}
            </span>
          ) : null}
          {task.person_name ? (
            <PersonAvatar name={task.person_name} slug={task.domain_slug} size={22} />
          ) : null}
          {due ? (
            <span className={cn("tabular", DUE_TONE_CLASS[tone])}>{due}</span>
          ) : scheduledOnly && task.scheduled_date ? (
            <span className="tabular">
              Do {relativeDayLabel(task.scheduled_date, today).toLowerCase()}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
