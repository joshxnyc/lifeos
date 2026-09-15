"use client";

// Swipe-left destination: Tomorrow / This weekend / Next week / Pick date.
// It moves the due date when the task has one, otherwise the scheduled ("do
// on") date; the toggle switches which.

import { useEffect, useState, useTransition } from "react";
import { rescheduleTask } from "@/app/(app)/tasks/actions";
import { Sheet, SheetOption } from "@/components/tasks/sheet";
import { toast } from "@/components/tasks/toast";
import { comingSaturday, formatShortDate, nextMonday, shiftDay, weekdayShort } from "@/components/tasks/format";
import { cn } from "@/lib/utils";
import type { TaskView } from "@/components/tasks/types";

type Target = "due" | "scheduled";

export function RescheduleSheet({
  task,
  today,
  onClose,
}: {
  task: TaskView | null;
  today: string;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<Target>("due");
  const [picked, setPicked] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!task) return;
    setTarget(!task.due_date && task.scheduled_date ? "scheduled" : "due");
    setPicked("");
  }, [task]);

  if (!task) return null;

  function apply(date: string | null) {
    const id = task?.id;
    if (!id) return;
    onClose();
    startTransition(async () => {
      const res = await rescheduleTask(
        id,
        target === "due" ? { due_date: date } : { scheduled_date: date },
      );
      if (!res.ok) toast(res.error);
      else toast(date ? `Moved to ${formatShortDate(date, today)}` : "Date cleared");
    });
  }

  const tomorrow = shiftDay(today, 1);
  const weekend = comingSaturday(today);
  const week = nextMonday(today);

  return (
    <Sheet open onClose={onClose} title="Reschedule">
      <p className="mb-3 line-clamp-2 text-[14px] text-ink-2">{task.title}</p>

      <div className="mb-3 flex rounded-card border border-line p-0.5">
        {(
          [
            ["due", "Due date"],
            ["scheduled", "Do on"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTarget(value)}
            className={cn(
              "h-9 flex-1 rounded-[7px] text-[13px]",
              target === value ? "bg-accent-soft text-ink" : "text-ink-2",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-3">
        <SheetOption label="Tomorrow" meta={weekdayShort(tomorrow)} onClick={() => apply(tomorrow)} />
        <SheetOption
          label="This weekend"
          meta={formatShortDate(weekend, today)}
          onClick={() => apply(weekend)}
        />
        <SheetOption label="Next week" meta={formatShortDate(week, today)} onClick={() => apply(week)} />
        <SheetOption label="Clear date" onClick={() => apply(null)} />
      </div>

      <label className="flex items-center gap-2 text-[13px] text-ink-2">
        Pick date
        <input
          type="date"
          value={picked}
          min={today}
          onChange={(e) => {
            setPicked(e.target.value);
            if (e.target.value) apply(e.target.value);
          }}
          className="h-11 flex-1 rounded-card border border-line bg-paper-2 px-3 text-[15px] text-ink"
        />
      </label>
    </Sheet>
  );
}
