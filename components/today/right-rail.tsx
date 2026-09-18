// Desktop-only right rail on Today (DESIGN_BRIEF §5.1): the full day's
// calendar and the next seven days of due tasks by day. Read-only by design —
// the interactive rows live in the main column.

import { cn } from "@/lib/utils";
import { DOMAIN_COLOR_CLASS, DOMAIN_EDGE_CLASS } from "@/components/ui/domain";
import { formatClock, formatClock24, relativeDayLabel } from "@/components/tasks/format";
import type { ScheduleEvent } from "@/components/today/schedule-strip";
import type { TaskView } from "@/components/tasks/types";

export function RightRail({
  events,
  timezone,
  upcoming,
  today,
}: {
  events: ScheduleEvent[];
  timezone: string;
  upcoming: Array<{ date: string; tasks: TaskView[] }>;
  today: string;
}) {
  return (
    <aside className="hidden shrink-0 border-l border-line pt-6 pl-8 lg:block lg:w-[280px]">
      {events.length > 0 ? (
        <section className="mb-7">
          <p className="section-label mb-3">Today</p>
          {/* Canvas 1t: each event is a paper-2 block with a 2px domain edge
              against a mono time column. */}
          <ul className="flex flex-col gap-1.5">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-2.5">
                <span className="tabular w-11 shrink-0 pt-1.5 font-mono text-[11px] text-ink-2">
                  {e.all_day ? "all day" : formatClock24(e.starts_at, timezone)}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 rounded-[6px] border-l-2 bg-paper-2 px-2 py-1.5 text-[13px] break-words text-ink",
                    e.domain_slug ? DOMAIN_EDGE_CLASS[e.domain_slug] : "border-l-ink-3",
                  )}
                >
                  {e.title || "Untitled"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <p className="section-label mb-1.5">Coming up this week</p>
        {upcoming.length === 0 ? (
          <p className="text-[13px] text-ink-2">Nothing due in the next seven days.</p>
        ) : (
          upcoming.map((day) => (
            // Canvas 1t: day label, title, domain dot — one hairline row each.
            <ul key={day.date}>
              {day.tasks.map((t, i) => (
                <li
                  key={t.id}
                  className="flex items-start gap-2.5 border-b border-line py-1.5 text-[13px]"
                >
                  <span className="tabular w-9 shrink-0 text-ink-2">
                    {i === 0 ? relativeDayLabel(day.date, today) : ""}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-ink">{t.title}</span>
                  {t.due_time ? (
                    <span className="tabular shrink-0 text-ink-2">{formatClock(t.due_time)}</span>
                  ) : null}
                  <span
                    className={cn(
                      "mt-1.5 size-[7px] shrink-0 rounded-full",
                      DOMAIN_COLOR_CLASS[t.domain_slug],
                    )}
                  />
                </li>
              ))}
            </ul>
          ))
        )}
      </section>
    </aside>
  );
}
