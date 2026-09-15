import { JobPill, Mono, Panel, Row, SettingsSection } from "@/components/settings/ui";
import type { JobRun } from "@/lib/types";

/**
 * AI & Jobs (SPEC §11 observability): the last run of every scheduled job and
 * what this month's AI usage cost. A sync that has quietly stopped shows up
 * here before it shows up as missing tasks.
 */
export const JOB_NAMES = [
  "sync-google",
  "sync-notion",
  "sync-granola",
  "extract",
  "process-captures",
  "notifications-tick",
  "routines-nightly",
  "plan-morning",
  "closeout-evening",
  "review-prompt",
  "dormancy-scan",
  "schedule-day",
];

export function JobsSection({
  runs,
  spend,
  extractionIntervalMinutes,
}: {
  runs: JobRun[];
  spend: { total: number; byPipeline: Array<{ pipeline: string; cost: number; calls: number }> };
  extractionIntervalMinutes: number;
}) {
  const latest = new Map<string, JobRun>();
  for (const run of runs) if (!latest.has(run.job)) latest.set(run.job, run);

  return (
    <SettingsSection
      title="AI & jobs"
      hint={`Extraction sweeps every ${extractionIntervalMinutes} minutes. Google syncs every 15, Notion and Granola every 30.`}
    >
      <Panel>
        {JOB_NAMES.map((job) => {
          const run = latest.get(job);
          return (
            <Row
              key={job}
              label={job}
              hint={
                run ? (
                  <>
                    {run.finished_at ? new Date(run.finished_at).toLocaleString() : "running"}
                    {run.stats && Object.keys(run.stats).length ? ` · ${summarize(run.stats)}` : ""}
                    {run.error ? <span className="mt-0.5 block text-danger">{run.error}</span> : null}
                  </>
                ) : (
                  "Never run"
                )
              }
            >
              {run ? <JobPill status={run.status} /> : <span className="text-[13px] text-ink-3">—</span>}
            </Row>
          );
        })}
      </Panel>

      <div className="mt-3">
        <Panel>
          <Row label="AI spend this month" hint="Estimated from logged token counts.">
            <Mono className="text-[14px] text-ink">${spend.total.toFixed(2)}</Mono>
          </Row>
          {spend.byPipeline.map((p) => (
            <Row key={p.pipeline} label={p.pipeline} hint={`${p.calls} calls`}>
              <Mono>${p.cost.toFixed(2)}</Mono>
            </Row>
          ))}
        </Panel>
      </div>
    </SettingsSection>
  );
}

/** "threads_seen 12 · items_written 9" — numbers, no adjectives. */
function summarize(stats: Record<string, unknown>): string {
  return Object.entries(stats)
    .filter(([, v]) => typeof v === "number" || typeof v === "string" || typeof v === "boolean")
    .slice(0, 4)
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(" · ");
}
