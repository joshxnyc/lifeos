"use client";

// TopItemCard (DESIGN_BRIEF §5.1): the one task for today, accent left rule,
// title in Fraunces. In Phase 1 Joshua picks it; from Phase 6 plan-morning
// proposes one and the reason line is filled in.

import { useState, useTransition } from "react";
import { completeTask } from "@/app/(app)/tasks/actions";
import { setTopItem } from "@/app/(app)/today/actions";
import { Sheet, SheetOption } from "@/components/tasks/sheet";
import { toast } from "@/components/tasks/toast";
import { formatDueLabel } from "@/components/tasks/format";
import { DomainChip } from "@/components/ui/domain";
import { Button } from "@/components/ui/button";
import type { TaskView } from "@/components/tasks/types";

export function TopItemCard({
  task,
  reason,
  proposed,
  candidates,
  today,
  canBlockTime,
}: {
  task: TaskView | null;
  reason: string | null;
  /** True when the app proposed this rather than Joshua choosing it. */
  proposed: boolean;
  candidates: TaskView[];
  today: string;
  canBlockTime: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(id: string) {
    setPicking(false);
    startTransition(async () => {
      const res = await setTopItem(id);
      if (!res.ok) toast(res.error);
    });
  }

  function done() {
    if (!task) return;
    startTransition(async () => {
      const res = await completeTask(task.id);
      if (!res.ok) toast(res.error);
      else toast("Top item done");
    });
  }

  async function blockTime() {
    if (!task || blocking) return;
    setBlocking(true);
    try {
      // A4 owns the calendar write; until it lands the route answers 501.
      const res = await fetch("/api/integrations/block-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      if (res.status === 501 || res.status === 404) {
        toast("Calendar writing isn't connected yet.");
      } else if (!res.ok) {
        toast("Could not block time. Check the account in Settings.");
      } else {
        toast("Time blocked");
      }
    } catch {
      toast("Could not reach the calendar.");
    } finally {
      setBlocking(false);
    }
  }

  const pickList = [
    ...candidates.filter((c) => c.id !== task?.id),
  ];

  if (!task) {
    return (
      <section className="mb-7 border-l-[3px] border-l-accent pl-3">
        <p className="section-label">Top item</p>
        <p className="mt-1 font-display text-[22px] text-ink-2">Nothing picked for today.</p>
        <div className="mt-2">
          <Button variant="secondary" onClick={() => setPicking(true)} disabled={pickList.length === 0}>
            {pickList.length === 0 ? "No open tasks" : "Pick one"}
          </Button>
        </div>
        <PickSheet
          open={picking}
          onClose={() => setPicking(false)}
          tasks={pickList}
          today={today}
          onChoose={choose}
        />
      </section>
    );
  }

  return (
    <section className="mb-7 border-l-[3px] border-l-accent pl-3">
      <p className="section-label">{proposed ? "Proposed top item" : "Top item"}</p>
      <h2 className="mt-1 font-display text-[22px] font-semibold leading-snug">{task.title}</h2>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <DomainChip slug={task.domain_slug} name={task.domain_name} />
        {task.due_date ? (
          <span className="tabular text-[13px] text-ink-2">
            {formatDueLabel(task.due_date, task.due_time, today)}
          </span>
        ) : null}
        {task.project_name ? (
          <span className="text-[13px] text-ink-2">{task.project_name}</span>
        ) : null}
      </div>
      {reason ? <p className="mt-1.5 text-[14px] text-ink-2">{reason}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={done} disabled={pending || task.is_mirror}>
          Done
        </Button>
        {canBlockTime ? (
          <Button variant="secondary" onClick={blockTime} disabled={blocking}>
            Block time
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => setPicking(true)}>
          Pick another
        </Button>
      </div>

      <PickSheet
        open={picking}
        onClose={() => setPicking(false)}
        tasks={pickList}
        today={today}
        onChoose={choose}
      />
    </section>
  );
}

function PickSheet({
  open,
  onClose,
  tasks,
  today,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  tasks: TaskView[];
  today: string;
  onChoose: (id: string) => void;
}) {
  if (!open) return null;
  return (
    <Sheet open onClose={onClose} title="Pick the top item">
      {tasks.length === 0 ? (
        <p className="py-6 text-[14px] text-ink-2">No open tasks for today.</p>
      ) : (
        tasks.map((t) => (
          <SheetOption
            key={t.id}
            label={t.title}
            meta={formatDueLabel(t.due_date, t.due_time, today) || t.domain_name}
            onClick={() => onChoose(t.id)}
          />
        ))
      )}
    </Sheet>
  );
}
