"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  acceptSuggestion,
  dismissSuggestion,
  undoAcceptSuggestion,
  undoDismissSuggestion,
} from "@/app/(app)/queue/actions";
import { toast } from "@/components/tasks/toast";
import { hideReasonStrip, showReasonStrip } from "@/components/queue/reason-strip";
import type { DomainSlug, SuggestionKind, SuggestionProposed } from "@/lib/types";

// DESIGN_BRIEF §5.3 — kind label, title, editable proposed chips, an inset
// evidence quote, a thin confidence bar (never a number), Accept / Dismiss,
// and swipe right/left on mobile with a colored underlay following the finger.

const KIND_LABEL: Record<SuggestionKind, string> = {
  task: "Commitment",
  deadline_change: "Deadline",
  follow_up: "Follow-up",
  person_fact: "About a person",
  project_update: "Project update",
};

export interface SuggestionCardProps {
  id: string;
  kind: SuggestionKind;
  title: string;
  detail: string | null;
  evidence: string | null;
  confidence: number;
  proposed: SuggestionProposed;
  domains: { id: string; name: string; slug: DomainSlug }[];
  projects: { id: string; name: string; domain_id: string }[];
  people: { id: string; name: string }[];
}

const SWIPE_THRESHOLD = 112;

export function SuggestionCard(props: SuggestionCardProps) {
  const router = useRouter();
  const [edited, setEdited] = useState<Partial<SuggestionProposed>>({});
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<null | "accepted" | "dismissed">(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Axis lock (same pattern as TaskRow): nothing moves until the pointer has
  // travelled 10px, and a gesture that starts more vertical than horizontal
  // belongs to the scroll, never to the swipe.
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"none" | "x" | "y">("none");
  const [pending, startTransition] = useTransition();

  const proposed: SuggestionProposed = { ...props.proposed, ...edited };
  const domainId = proposed.domain_id ?? "";
  const projectsInDomain = props.projects.filter((p) => !domainId || p.domain_id === domainId);

  function set<K extends keyof SuggestionProposed>(key: K, value: SuggestionProposed[K]) {
    setEdited((prev) => ({ ...prev, [key]: value }));
  }

  function runUndo(action: "accept" | "dismiss") {
    const revert = action === "accept" ? undoAcceptSuggestion : undoDismissSuggestion;
    void revert(props.id)
      .then((result) => {
        if (!result.ok) {
          toast(result.error);
          return;
        }
        // An undone dismissal takes its reason strip with it — the row is
        // pending again and a reason would no longer apply.
        if (action === "dismiss") hideReasonStrip(props.id);
        // If this card is still mounted, put it straight back; either way the
        // refresh brings the pending suggestion back into the queue.
        setResolved(null);
        setDx(0);
        router.refresh();
      })
      .catch(() => {
        toast("That undo didn't work.");
      });
  }

  function run(action: "accept" | "dismiss") {
    setError(null);
    startTransition(async () => {
      try {
        if (action === "accept") await acceptSuggestion(props.id, edited);
        else await dismissSuggestion(props.id);
        setResolved(action === "accept" ? "accepted" : "dismissed");
        toast(action === "accept" ? "Accepted" : "Dismissed", {
          label: "Undo",
          onPress: () => runUndo(action),
        });
        // A dismiss also raises the reason strip (hosted by the queue page,
        // so it outlives this card): one optional tap that records why.
        if (action === "dismiss") showReasonStrip(props.id);
        router.refresh();
      } catch (err) {
        setDx(0);
        setError(err instanceof Error ? err.message : "That didn't work.");
      }
    });
  }

  if (resolved) {
    return (
      <div className="rounded-card border border-line px-3.5 py-3 text-[13px] text-ink-2">
        {resolved === "accepted" ? "Accepted." : "Dismissed."}
      </div>
    );
  }

  // Canvas 1e: accent underlay behind an accept swipe, ink-3 behind a dismiss.
  const underlay = dx > 0 ? "bg-accent text-paper" : "bg-ink-3 text-paper";

  return (
    <div className="relative overflow-hidden rounded-card">
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-between px-[18px] text-[14px] font-medium",
          underlay,
        )}
        aria-hidden
      >
        <span className={dx > 24 ? "opacity-100" : "opacity-0"}>Accept</span>
        <span className={dx < -24 ? "opacity-100" : "opacity-0"}>Dismiss</span>
      </div>

      <article
        style={{ transform: `translateX(${dx}px)` }}
        className={cn(
          "relative touch-pan-y rounded-card border border-line bg-paper p-3.5",
          !dragging && "transition-transform duration-150",
          pending && "opacity-60",
        )}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("select, input, textarea, button, a")) return;
          start.current = { x: e.clientX, y: e.clientY };
          axis.current = "none";
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const ddx = e.clientX - s.x;
          const ddy = e.clientY - s.y;
          if (axis.current === "none") {
            if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return;
            axis.current = Math.abs(ddx) > Math.abs(ddy) ? "x" : "y";
          }
          if (axis.current !== "x") return;
          setDragging(true);
          setDx(ddx);
        }}
        onPointerUp={() => {
          const travelled = axis.current === "x" ? dx : 0;
          start.current = null;
          axis.current = "none";
          setDragging(false);
          if (travelled > SWIPE_THRESHOLD) run("accept");
          else if (travelled < -SWIPE_THRESHOLD) run("dismiss");
          else setDx(0);
        }}
        onPointerCancel={() => {
          start.current = null;
          axis.current = "none";
          setDragging(false);
          setDx(0);
        }}
      >
        <p className="section-label">{KIND_LABEL[props.kind]}</p>
        <h3 className="mt-1 text-[17px] leading-[1.35] font-medium text-ink">{props.title}</h3>
        {props.detail ? <p className="mt-1 text-[13px] text-ink-2">{props.detail}</p> : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <ChipSelect
            label="Domain"
            value={domainId}
            onChange={(v) => {
              set("domain_id", v || undefined);
              set("project_id", undefined);
            }}
            options={props.domains.map((d) => ({ value: d.id, label: d.name }))}
            placeholder="No domain"
          />
          <ChipSelect
            label="Project"
            value={proposed.project_id ?? ""}
            onChange={(v) => set("project_id", v || undefined)}
            options={projectsInDomain.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="No project"
          />
          <ChipSelect
            label="Person"
            value={proposed.person_id ?? ""}
            onChange={(v) => set("person_id", v || undefined)}
            options={props.people.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="No person"
          />
          <label className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-paper-2 px-2.5 text-[13px] text-ink-2">
            <span className="sr-only">Due date</span>
            <input
              type="date"
              value={proposed.due_date ?? ""}
              onChange={(e) => set("due_date", e.target.value || undefined)}
              className="bg-transparent text-[13px] text-ink outline-none"
            />
          </label>
        </div>

        {/* EvidenceQuote (canvas 1e): inset, Fraunces italic, ink-2, quoted. */}
        {props.evidence ? (
          <blockquote className="mt-3 ml-2 border-l-2 border-line py-1.5 pl-3 font-display text-[15px] leading-[1.45] italic text-ink-2">
            {`“${props.evidence}”`}
          </blockquote>
        ) : null}

        {/* Confidence as a thin bar, never a number (DESIGN_BRIEF §5.3). */}
        <div
          className="mt-3 h-[2px] w-full rounded-[2px] bg-line"
          role="img"
          aria-label={`Confidence ${Math.round(props.confidence * 100)} percent`}
        >
          <div
            className={cn("h-full rounded-[2px]", props.confidence >= 0.75 ? "bg-ok" : "bg-warn")}
            style={{ width: `${Math.round(Math.min(1, Math.max(0, props.confidence)) * 100)}%` }}
          />
        </div>

        {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}

        <div className="mt-3 flex items-center justify-end gap-4">
          <button
            type="button"
            disabled={pending}
            onClick={() => run("dismiss")}
            className="inline-flex h-11 items-center px-1 text-[14px] text-ink-2 disabled:opacity-50"
          >
            Dismiss
          </button>
          <Button variant="primary" disabled={pending} onClick={() => run("accept")}>
            Accept
          </Button>
        </div>
      </article>
    </div>
  );
}

function ChipSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  if (!options.length) return null;
  return (
    <label className="inline-flex min-h-11 items-center rounded-full bg-paper-2 px-2.5 text-[13px] text-ink-2">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[9rem] bg-transparent text-[13px] text-ink outline-none"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
