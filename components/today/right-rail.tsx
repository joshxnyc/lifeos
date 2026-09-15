// Desktop-only right rail on Today (DESIGN_BRIEF §5.1): the full day's
// calendar and the next seven days of due tasks by day. Read-only by design —
// the interactive rows live in the main column.

import { cn } from "@/lib/utils";
import { DOMAIN_COLOR_CLASS } from "@/components/ui/domain";
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
    <aside className="hidden shrink-0 lg:block lg:w-[260px]">
      {events.length > 0 ? (
        <section className="mb-7">
          <p className="section-label mb-1.5">Today</p>
          <ul className="border-t border-line">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-2 border-b border-line py-2 last:border-b-0">
                <span className="tabular w-11 shrink-0 font-mono text-[11px] text-ink-2">
                  {e.all_day ? "all day" : formatClock24(e.starts_at, timezone)}
                </span>
                <span
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    e.domain_slug ? DOMAIN_COLOR_CLASS[e.domain_slug] : "bg-ink-3",
                  )}
                />
                <span className="min-w-0 flex-1 break-words text-[13px] text-ink">
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
            <div key={day.date} className="mb-3">
              <p className="tabular mb-1 text-[12px] text-ink-2">
                {relativeDayLabel(day.date, today)}
              </p>
              <ul>
                {day.tasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 py-1">
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        DOMAIN_COLOR_CLASS[t.domain_slug],
                      )}
                    />
                    <span className="min-w-0 flex-1 break-words text-[13px] text-ink">{t.title}</span>
                    {t.due_time ? (
                      <span className="tabular shrink-0 text-[12px] text-ink-2">
                        {formatClock(t.due_time)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </aside>
  );
}
