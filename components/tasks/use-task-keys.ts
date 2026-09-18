"use client";

// Desktop keyboard navigation for task lists: j/k move a roving focus through
// the visible rows, x completes the focused task (same animation and Undo
// toast as a tap), e opens what tapping the row opens, t opens reschedule,
// Escape clears the focus. Nothing here runs while an input, textarea, select
// or contenteditable has focus, and touch interaction is untouched — the hook
// only listens for keydown.

import { useEffect, useRef, useState } from "react";
import type { TaskView } from "@/components/tasks/types";

/**
 * Next roving index. From nowhere (-1), j lands on the first row and k on the
 * last; after that the focus clamps at the ends instead of wrapping.
 * Pure so it can be unit-tested.
 */
export function moveFocus(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (current < 0 || current >= length) return delta > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, current + delta));
}

/** True when the key press belongs to a form field, not the list. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function useTaskListKeys({
  tasks,
  disabled,
  onComplete,
  onEdit,
  onReschedule,
}: {
  /** The visible rows, flattened in render order. */
  tasks: TaskView[];
  /** True while a sheet is open — keys then belong to the sheet. */
  disabled: boolean;
  onComplete: (task: TaskView) => void;
  onEdit: (task: TaskView) => void;
  onReschedule: (task: TaskView) => void;
}): string | null {
  const [index, setIndex] = useState(-1);
  // Handlers and list live in a ref so the single window listener always sees
  // the latest without re-binding; the index ref keeps rapid j/j correct even
  // before React re-renders.
  const indexRef = useRef(index);
  const latest = useRef({ tasks, disabled, onComplete, onEdit, onReschedule });
  latest.current = { tasks, disabled, onComplete, onEdit, onReschedule };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const { tasks, disabled, onComplete, onEdit, onReschedule } = latest.current;
      if (disabled || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;

      if (e.key === "j" || e.key === "k") {
        if (!tasks.length) return;
        e.preventDefault();
        const next = moveFocus(indexRef.current, e.key === "j" ? 1 : -1, tasks.length);
        indexRef.current = next;
        setIndex(next);
        const row = tasks[next];
        if (row) {
          document
            .querySelector(`[data-task-id="${row.id}"]`)
            ?.scrollIntoView({ block: "nearest" });
        }
        return;
      }

      if (e.key === "Escape") {
        indexRef.current = -1;
        setIndex(-1);
        return;
      }

      const task = tasks[indexRef.current];
      if (!task) return;
      if (e.key === "x") {
        e.preventDefault();
        onComplete(task);
      } else if (e.key === "e") {
        e.preventDefault();
        onEdit(task);
      } else if (e.key === "t") {
        e.preventDefault();
        onReschedule(task);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // When rows disappear under the focus (completed, refiltered), clamp it.
  useEffect(() => {
    if (index >= 0 && index >= tasks.length) {
      const next = tasks.length ? tasks.length - 1 : -1;
      indexRef.current = next;
      setIndex(next);
    }
  }, [tasks.length, index]);

  return index >= 0 ? (tasks[index]?.id ?? null) : null;
}
