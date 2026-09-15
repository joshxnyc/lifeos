"use client";

// ScheduleStrip (DESIGN_BRIEF §5.1): today's meetings as a compact horizontal
// timeline with a one-line summary; tapping expands to the list. Rendered only
// when calendar events exist at all (progressive enablement, SPEC §9).

import { useState } from "react";
import { cn } from "@/lib/utils";
import { DOMAIN_COLOR_CLASS } from "@/components/ui/domain";
import { formatClock24 } from "@/components/tasks/format";
import type { DomainSlug } from "@/lib/types";

export interface ScheduleEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  html_link: string | null;
  domain_slug: DomainSlug | null;
}

export function ScheduleStrip({
  events,
  timezone,
}: {
  events: ScheduleEvent[];
  timezone: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const timed = events.filter((e) => !e.all_day);
  const minutes = timed.reduce((total, e) => {
    const ms = new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime();
    return total + (Number.isFinite(ms) && ms > 0 ? ms / 60_000 : 0);
  }, 0);
  const hours = Math.round((minutes / 60) * 10) / 10;
  const first = timed[0];

  const summary = first
    ? `First meeting ${formatClock24(first.starts_at, timezone)} · ${hours}h of meetings`
    : events.length > 0
      ? "Nothing timed today"
      : "";

  return (
    <section className="mb-7">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-11 w-full items-baseline justify-between gap-3 text-left"
      >
        <span className="section-label">Schedule</span>
        <span className="text-[13px] text-ink-2">{summary}</span>
      </button>

      {expanded ? (
        <ul className="border-t border-line">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 border-b border-line py-2.5 last:border-b-0">
              <span className="tabular w-12 shrink-0 font-mono text-[12px] text-ink-2">
                {e.all_day ? "all day" : formatClock24(e.starts_at, timezone)}
              </span>
              <span
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  e.domain_slug ? DOMAIN_COLOR_CLASS[e.domain_slug] : "bg-ink-3",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[14px] text-ink">{e.title || "Untitled"}</span>
                {e.location ? (
                  <span className="block truncate text-[12px] text-ink-2">{e.location}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pt-1 md:mx-0 md:px-0">
          {events.map((e) => (
            <div
              key={e.id}
              className="flex w-36 shrink-0 flex-col gap-1 rounded-card border border-line px-2.5 py-2"
            >
              <span className="tabular font-mono text-[11px] text-ink-2">
                {e.all_day ? "all day" : formatClock24(e.starts_at, timezone)}
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    e.domain_slug ? DOMAIN_COLOR_CLASS[e.domain_slug] : "bg-ink-3",
                  )}
                />
                <span className="truncate text-[13px] text-ink">{e.title || "Untitled"}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
