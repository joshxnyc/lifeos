import { JobPill, Mono, Panel, Row, SettingsSection } from "@/components/settings/ui";
import { RunJobButton } from "@/components/settings/run-job-button";
import type { JobRun } from "@/lib/types";

/**
 * AI & Jobs (SPEC §11 observability): the last run of every scheduled job and
 * what this month's AI usage cost. A sync that has quietly stopped shows up
 * here before it shows up as missing tasks. Jobs that are safe to poke by
 * hand get a Run now button — same secret-protected route the cron calls.
 */
const JOBS: Array<{ job: string; label: string; runnable: boolean }> = [
  { job: "sync-google", label: "Gmail & Calendar sync", runnable: true },
  { job: "sync-notion", label: "Notion mirror", runnable: true },
  { job: "sync-granola", label: "Granola sync", runnable: true },
  { job: "extract", label: "Extraction sweep", runnable: true },
  { job: "process-captures", label: "Capture processing", runnable: true },
  { job: "notifications-tick", label: "Notification delivery", runnable: false },
  { job: "routines-nightly", label: "Routine nightly close", runnable: false },
  { job: "plan-morning", label: "Morning plan & brief", runnable: false },
  { job: "closeout-evening", label: "Evening close-out", runnable: false },
  { job: "review-prompt", label: "Weekly review prompt", runnable: false },
  { job: "dormancy-scan", label: "Dormancy scan", runnable: true },
  { job: "schedule-day", label: "Day scheduling", runnable: false },
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
      title="Scheduled jobs"
      hint={`Extraction sweeps every ${extractionIntervalMinutes} minutes. Google syncs every 15, Notion and Granola every 30.`}
    >
      <Panel>
        {JOBS.map(({ job, label, runnable }) => {
          const run = latest.get(job);
          return (
            <Row
              key={job}
              label={label}
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
              {runnable ? <RunJobButton job={job} /> : null}
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
