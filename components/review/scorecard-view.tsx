import { StatTile } from "@/components/review/stat-tile";
import { cn } from "@/lib/utils";
import { DOMAIN_COLOR_CLASS } from "@/components/ui/domain";
import type { Domain, DomainSlug, Scorecard } from "@/lib/types";

// SPEC §7.5 rendered per DESIGN_BRIEF §5.9 step 1. One machine sentence at the
// top, tiles with deltas, a per-domain bar, a per-routine dot row. No adjectives.

/** Rates may arrive as 0..1 or 0..100 depending on the pure function; normalize. */
function asPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

export function onTimeRate(scorecard: Scorecard): number | null {
  const decided = scorecard.commitments.on_time + scorecard.commitments.late;
  return decided ? (scorecard.commitments.on_time / decided) * 100 : null;
}

export function routineAdherence(scorecard: Scorecard): number | null {
  if (!scorecard.routines.length) return null;
  const sum = scorecard.routines.reduce((acc, r) => acc + (asPercent(r.adherence) ?? 0), 0);
  return sum / scorecard.routines.length;
}

export function machineSummary(scorecard: Scorecard): string {
  const onTime = onTimeRate(scorecard);
  const adherence = routineAdherence(scorecard);
  const parts = [
    `${scorecard.total.completed} completed, ${scorecard.total.created} created, ${scorecard.total.overdue_at_week_end} overdue at week end.`,
    onTime === null ? "No dated commitments closed." : `On time on ${Math.round(onTime)} percent of commitments.`,
    adherence === null ? "No routines scheduled." : `Routine adherence ${Math.round(adherence)} percent.`,
    `Queue: ${scorecard.queue.received} in, ${scorecard.queue.accepted} accepted, ${scorecard.queue.dismissed} dismissed, ${scorecard.queue.pending_at_week_end} still pending.`,
  ];
  return parts.join(" ");
}

export function ScorecardView({
  scorecard,
  domains,
}: {
  scorecard: Scorecard;
  domains: Pick<Domain, "id" | "name" | "slug">[];
}) {
  const onTime = onTimeRate(scorecard);
  const adherence = routineAdherence(scorecard);
  const deltas = scorecard.deltas?.vs_4wk_avg ?? { completed: null, on_time_rate: null, adherence: null };

  const domainRows = domains
    .map((d) => ({ domain: d, stats: scorecard.domains?.[d.id] }))
    .filter((row) => row.stats);
  const maxBar = Math.max(
    1,
    ...domainRows.map((r) => Math.max(r.stats!.completed, r.stats!.created)),
  );

  return (
    <div>
      <p className="text-[15px] leading-relaxed text-ink-2">{machineSummary(scorecard)}</p>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Completed" value={scorecard.total.completed} delta={deltas.completed} />
        <StatTile
          label="On time"
          value={onTime === null ? "—" : Math.round(onTime)}
          suffix={onTime === null ? undefined : "%"}
          delta={asPercent(deltas.on_time_rate)}
        />
        <StatTile
          label="Routine adherence"
          value={adherence === null ? "—" : Math.round(adherence)}
          suffix={adherence === null ? undefined : "%"}
          delta={asPercent(deltas.adherence)}
        />
        <StatTile
          label="Queue cleared"
          value={scorecard.queue.accepted + scorecard.queue.dismissed}
        />
        <StatTile label="Still open" value={scorecard.total.open} goodDirection="down" />
        <StatTile
          label="Overdue at week end"
          value={scorecard.total.overdue_at_week_end}
          goodDirection="down"
        />
        <StatTile label="Captures" value={scorecard.captures.count} />
        <StatTile
          label="Follow-ups overdue"
          value={scorecard.people_overdue_followup}
          goodDirection="down"
        />
      </div>

      {domainRows.length ? (
        <section className="mt-7">
          <h2 className="section-label mb-2">Completed against created, by domain</h2>
          <div className="space-y-3">
            {domainRows.map(({ domain, stats }) => (
              <div key={domain.id} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-[13px] text-ink-2">{domain.name}</span>
                <span className="flex-1">
                  <span className="block h-2 rounded-full bg-line">
                    <span
                      className={cn("block h-2 rounded-full", DOMAIN_COLOR_CLASS[domain.slug as DomainSlug])}
                      style={{ width: `${(stats!.completed / maxBar) * 100}%` }}
                    />
                  </span>
                  <span className="mt-1 block h-[3px] rounded-full bg-line">
                    <span
                      className="block h-[3px] rounded-full bg-ink-3"
                      style={{ width: `${(stats!.created / maxBar) * 100}%` }}
                    />
                  </span>
                </span>
                <span className="w-24 shrink-0 text-right text-[12px] text-ink-2 tabular">
                  {stats!.completed} of {stats!.created}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {scorecard.routines.length ? (
        <section className="mt-7">
          <h2 className="section-label mb-2">Routines this week</h2>
          <div className="space-y-2">
            {scorecard.routines.map((routine) => (
              <div key={routine.routine_id} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-[13px] text-ink">{routine.name}</span>
                <span className="flex flex-1 items-center gap-1" aria-hidden>
                  {dotRow(routine).map((tone, i) => (
                    <span
                      key={i}
                      className={cn(
                        "size-2.5 rounded-full",
                        tone === "done" && "bg-ok",
                        tone === "missed" && "bg-danger",
                        tone === "skipped" && "border border-ink-3",
                        tone === "off" && "bg-line",
                      )}
                    />
                  ))}
                </span>
                <span className="shrink-0 text-[12px] text-ink-2 tabular">
                  {routine.done}/{routine.scheduled} · streak {routine.current_streak}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

type Tone = "done" | "missed" | "skipped" | "off";

function dotRow(routine: Scorecard["routines"][number]): Tone[] {
  const dots: Tone[] = [];
  for (let i = 0; i < routine.done; i++) dots.push("done");
  for (let i = 0; i < routine.missed; i++) dots.push("missed");
  for (let i = 0; i < routine.skipped; i++) dots.push("skipped");
  while (dots.length < 7) dots.push("off");
  return dots.slice(0, 7);
}
