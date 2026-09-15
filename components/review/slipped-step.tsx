"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { goToStep, recordSlippedDecision } from "@/app/(app)/review/actions";

// DESIGN_BRIEF §5.9 step 2 — one overdue task at a time, centred, with its
// context. Reschedule / Drop / Delegate. No skip.

export interface SlippedTask {
  id: string;
  title: string;
  due_date: string | null;
  domain_name: string | null;
  project_name: string | null;
  person_name: string | null;
  source_title: string | null;
  days_overdue: number | null;
}

function addDaysLocal(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextWeekday(today: string, weekday: number): string {
  const current = new Date(`${today}T00:00:00Z`).getUTCDay();
  const delta = (weekday - current + 7) % 7 || 7;
  return addDaysLocal(today, delta);
}

export function SlippedStep({
  weekStart,
  today,
  tasks,
  people,
  decided,
}: {
  weekStart: string;
  today: string;
  tasks: SlippedTask[];
  people: { id: string; name: string }[];
  decided: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "reschedule" | "drop" | "delegate">(null);
  const [date, setDate] = useState(addDaysLocal(today, 1));
  const [reason, setReason] = useState("");
  const [personId, setPersonId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const task = tasks[0];
  const total = decided + tasks.length;

  function reset() {
    setMode(null);
    setReason("");
    setPersonId("");
    setError(null);
    setDate(addDaysLocal(today, 1));
  }

  function decide(payload: Parameters<typeof recordSlippedDecision>[1]) {
    setError(null);
    startTransition(async () => {
      try {
        await recordSlippedDecision(weekStart, payload);
        reset();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "That didn't save.");
      }
    });
  }

  if (!task) {
    return (
      <div className="py-10">
        <p className="font-display text-[22px] leading-snug">
          {total === 0 ? "Nothing slipped this week." : `${total} decided. Nothing left overdue.`}
        </p>
        <div className="mt-5">
          <Button variant="primary" onClick={() => startTransition(async () => goToStep(weekStart, 3))}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  const context = [task.domain_name, task.project_name, task.person_name, task.source_title]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-[560px] py-6">
      <p className="section-label">
        {decided + 1} of {total}
      </p>

      <article className="mt-3 rounded-card border border-line bg-paper-2 p-5">
        <h2 className="font-display text-[22px] font-semibold leading-snug">{task.title}</h2>
        <p className="mt-2 text-[13px] text-ink-2">
          {task.due_date ? `Due ${task.due_date}` : "No due date"}
          {task.days_overdue ? ` · ${task.days_overdue} days overdue` : ""}
        </p>
        {context ? <p className="mt-1 text-[13px] text-ink-2">{context}</p> : null}
      </article>

      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}

      {mode === null ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setMode("reschedule")}>
            Reschedule
          </Button>
          <Button variant="secondary" onClick={() => setMode("drop")}>
            Drop
          </Button>
          <Button variant="secondary" onClick={() => setMode("delegate")}>
            Delegate
          </Button>
        </div>
      ) : null}

      {mode === "reschedule" ? (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Tomorrow", value: addDaysLocal(today, 1) },
              { label: "This weekend", value: nextWeekday(today, 6) },
              { label: "Next week", value: nextWeekday(today, 1) },
            ].map((option) => (
              <Button
                key={option.label}
                variant={date === option.value ? "primary" : "secondary"}
                onClick={() => setDate(option.value)}
              >
                {option.label}
              </Button>
            ))}
            <label className="inline-flex h-11 items-center rounded-card border border-line px-3 text-[14px]">
              <span className="sr-only">Pick a date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-[14px] text-ink outline-none"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={pending || !date}
              onClick={() => decide({ task_id: task.id, decision: "reschedule", new_due: date })}
            >
              Move to {date}
            </Button>
            <Button variant="ghost" onClick={reset}>
              Back
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "drop" ? (
        <div className="mt-5 space-y-3">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this going away"
            className="h-11 w-full rounded-card border border-line bg-paper-2 px-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={pending || !reason.trim()}
              onClick={() => decide({ task_id: task.id, decision: "drop", note: reason.trim() })}
            >
              Drop it
            </Button>
            <Button variant="ghost" onClick={reset}>
              Back
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "delegate" ? (
        <div className="mt-5 space-y-3">
          <select
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            className="h-11 w-full rounded-card border border-line bg-paper-2 px-3 text-[15px] text-ink"
          >
            <option value="">Who owns it now</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="text-[12px] text-ink-2">
            It becomes a follow-up you are owed, and shows on their Person page.
          </p>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={pending || !personId}
              onClick={() =>
                decide({ task_id: task.id, decision: "delegate", delegate_person_id: personId })
              }
            >
              Delegate
            </Button>
            <Button variant="ghost" onClick={reset}>
              Back
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
