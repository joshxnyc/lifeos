"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { acceptSuggestion, dismissSuggestion } from "@/app/(app)/queue/actions";
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

const SWIPE_THRESHOLD = 96;

export function SuggestionCard(props: SuggestionCardProps) {
  const router = useRouter();
  const [edited, setEdited] = useState<Partial<SuggestionProposed>>({});
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<null | "accepted" | "dismissed">(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const [pending, startTransition] = useTransition();

  const proposed: SuggestionProposed = { ...props.proposed, ...edited };
  const domainId = proposed.domain_id ?? "";
  const projectsInDomain = props.projects.filter((p) => !domainId || p.domain_id === domainId);

  function set<K extends keyof SuggestionProposed>(key: K, value: SuggestionProposed[K]) {
    setEdited((prev) => ({ ...prev, [key]: value }));
  }

  function run(action: "accept" | "dismiss") {
    setError(null);
    startTransition(async () => {
      try {
        if (action === "accept") await acceptSuggestion(props.id, edited);
        else await dismissSuggestion(props.id);
        setResolved(action === "accept" ? "accepted" : "dismissed");
        router.refresh();
      } catch (err) {
        setDx(0);
        setError(err instanceof Error ? err.message : "That didn't work.");
      }
    });
  }

  if (resolved) {
    return (
      <div className="border-b border-line px-1 py-3 text-[13px] text-ink-2">
        {resolved === "accepted" ? "Accepted." : "Dismissed."}
      </div>
    );
  }

  const underlay = dx > 0 ? "bg-accent-soft" : "bg-paper-2";

  return (
    <div className="relative overflow-hidden border-b border-line">
      <div
        className={cn("absolute inset-0 flex items-center justify-between px-5 text-[13px]", underlay)}
        aria-hidden
      >
        <span className={cn("text-accent", dx > 24 ? "opacity-100" : "opacity-0")}>Accept</span>
        <span className={cn("text-ink-2", dx < -24 ? "opacity-100" : "opacity-0")}>Dismiss</span>
      </div>

      <article
        style={{ transform: `translateX(${dx}px)` }}
        className={cn(
          "relative bg-paper py-4 pl-1 pr-1 touch-pan-y",
          !dragging && "transition-transform duration-150",
          pending && "opacity-60",
        )}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("select, input, button, a")) return;
          startX.current = e.clientX;
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!dragging) return;
          setDx(e.clientX - startX.current);
        }}
        onPointerUp={() => {
          setDragging(false);
          if (dx > SWIPE_THRESHOLD) run("accept");
          else if (dx < -SWIPE_THRESHOLD) run("dismiss");
          else setDx(0);
        }}
        onPointerCancel={() => {
          setDragging(false);
          setDx(0);
        }}
      >
        <p className="section-label">{KIND_LABEL[props.kind]}</p>
        <h3 className="mt-1 text-[17px] font-medium leading-snug text-ink">{props.title}</h3>
        {props.detail ? <p className="mt-1 text-[13px] text-ink-2">{props.detail}</p> : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
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
          <label className="inline-flex h-11 items-center gap-1.5 rounded-full border border-line px-3 text-[12px] text-ink-2">
            <span className="sr-only">Due date</span>
            <input
              type="date"
              value={proposed.due_date ?? ""}
              onChange={(e) => set("due_date", e.target.value || undefined)}
              className="bg-transparent text-[12px] text-ink outline-none"
            />
          </label>
        </div>

        {props.evidence ? (
          <blockquote className="mt-3 border-l-2 border-line py-0.5 pl-3 font-display text-[14px] italic leading-relaxed text-ink-2">
            {props.evidence}
          </blockquote>
        ) : null}

        <div
          className="mt-3 h-[3px] w-24 rounded-full bg-line"
          role="img"
          aria-label={`Confidence ${Math.round(props.confidence * 100)} percent`}
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, props.confidence)) * 100)}%` }}
          />
        </div>

        {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}

        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" disabled={pending} onClick={() => run("accept")}>
            Accept
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => run("dismiss")}>
            Dismiss
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
    <label className="inline-flex h-11 items-center rounded-full border border-line px-3 text-[12px] text-ink-2">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[9rem] bg-transparent text-[12px] text-ink outline-none"
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
