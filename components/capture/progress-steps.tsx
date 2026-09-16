"use client";

// Capture progress (Joshua, 2026-09-16: "have an animation so we know
// something is happening"). Three labelled steps driven by the polled
// capture.status, the active one marked with a pulsing accent dot, plus the
// elapsed seconds so a slow one reads as slow rather than broken.
//
// Motion is an opacity pulse on a 6px dot and nothing else: globals.css
// flattens animation duration under prefers-reduced-motion, and
// motion-reduce:animate-none drops it entirely.

import { FilingDot } from "@/components/capture/filing-indicator";
import { cn } from "@/lib/utils";

const STEPS = ["Transcribing", "Filing", "Done"] as const;

/** Which step a capture status is sitting on. */
function stepIndex(status: string | undefined): number {
  if (status === "done") return 2;
  if (status === "filing") return 1;
  return 0; // pending, transcribing, or nothing back from the poll yet
}

export function CaptureProgress({
  status,
  elapsedSeconds,
  stalled,
}: {
  status: string | undefined;
  elapsedSeconds: number;
  stalled: boolean;
}) {
  const active = stepIndex(status);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ol className="flex items-center gap-2 text-[13px]" aria-label="Filing progress">
          {STEPS.map((label, i) => {
            const state = i < active ? "done" : i === active ? "active" : "todo";
            return (
              <li key={label} className="flex items-center gap-2">
                {i > 0 ? (
                  <span aria-hidden className="text-ink-3">
                    →
                  </span>
                ) : null}
                <span className="flex items-center gap-1.5">
                  {state === "active" && status !== "done" ? (
                    <FilingDot />
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        state === "todo" ? "border border-line" : "bg-ok",
                      )}
                    />
                  )}
                  <span
                    aria-current={state === "active" ? "step" : undefined}
                    className={state === "todo" ? "text-ink-3" : "text-ink-2"}
                  >
                    {label}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        <span className="tabular font-mono text-[11px] text-ink-2">{elapsedSeconds}s</span>
      </div>

      {stalled ? (
        <p className="mt-2 text-[13px] text-ink-2">
          Still working. You can leave — it finishes in the background.
        </p>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {STEPS[active]}
      </p>
    </div>
  );
}
