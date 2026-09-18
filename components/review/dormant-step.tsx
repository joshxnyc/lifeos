"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { goToStep, recordDormantDecision } from "@/app/(app)/review/actions";

// DESIGN_BRIEF §5.9 step 3 — dormant projects and lapsed people, one at a
// time. Revive needs a next action; it becomes a task.

export interface DormantItem {
  kind: "project" | "person";
  id: string;
  name: string;
  detail: string | null;
  quiet_for: string; // "23 days"
}

export function DormantStep({
  weekStart,
  items,
  decided,
}: {
  weekStart: string;
  items: DormantItem[];
  decided: number;
}) {
  const router = useRouter();
  const [nextAction, setNextAction] = useState("");
  const [reviving, setReviving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const item = items[0];
  const total = decided + items.length;

  function decide(decision: "revive" | "park" | "close", action?: string) {
    setError(null);
    startTransition(async () => {
      try {
        await recordDormantDecision(weekStart, {
          ...(item!.kind === "project" ? { project_id: item!.id } : { person_id: item!.id }),
          decision,
          next_action: action,
        });
        setNextAction("");
        setReviving(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "That didn't save.");
      }
    });
  }

  if (!item) {
    return (
      <div className="py-10">
        <p className="display-lead">
          {total === 0 ? "Nothing dormant." : `${total} decided. Nothing left dormant.`}
        </p>
        <div className="mt-5">
          <Button variant="primary" onClick={() => startTransition(async () => goToStep(weekStart, 4))}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[560px] py-6">
      <p className="section-label">
        {decided + 1} of {total}
      </p>

      {/* Canvas 1o: same raised decision card as Slipped, with the kind and
          the quiet stretch as the label line. */}
      <article className="mt-3 rounded-card border border-line bg-raise px-[18px] py-[22px] shadow-whisper">
        <p className="section-label">
          {item.kind === "project" ? "Project" : "Person"} · no activity for {item.quiet_for}
        </p>
        <h2 className="display-lead mt-2">{item.name}</h2>
        {item.detail ? <p className="mt-3.5 text-[13px] text-ink-2">{item.detail}</p> : null}
      </article>

      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}

      {reviving ? (
        <div className="mt-5 space-y-3">
          <input
            autoFocus
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            placeholder={item.kind === "project" ? "The next action on this" : `The next move with ${item.name}`}
            className="h-11 w-full rounded-card border border-line bg-paper-2 px-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={pending || !nextAction.trim()}
              onClick={() => decide("revive", nextAction.trim())}
            >
              Create task
            </Button>
            <Button variant="ghost" onClick={() => setReviving(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-2">
          <Button
            variant="primary"
            onClick={() => setReviving(true)}
            className="h-auto w-full rounded-card bg-ink py-3.5 text-[15px] text-paper"
          >
            Revive with a next action
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => decide("park")}
              className="h-auto w-full rounded-card py-3.5 text-[15px]"
            >
              Park
            </Button>
            {item.kind === "project" ? (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => decide("close")}
                className="h-auto w-full rounded-card py-3.5 text-[15px]"
              >
                Close
              </Button>
            ) : null}
          </div>
        </div>
      )}
      {item.kind === "person" ? (
        <p className="mt-3 text-[12px] text-ink-2">Park clears the follow-up cadence, so the nudges stop.</p>
      ) : null}
    </div>
  );
}
