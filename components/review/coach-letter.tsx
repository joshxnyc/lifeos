"use client";

import { useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { finishReview, generateCoach, setOneChangeAccepted } from "@/app/(app)/review/actions";

// DESIGN_BRIEF §5.9 step 5 — typeset like a short letter: first line in
// Fraunces 22, body in Inter 17 with generous leading, then one boxed change.

export function CoachLetter({
  weekStart,
  read,
  oneChange,
  accepted,
  model,
}: {
  weekStart: string;
  read: string | null;
  oneChange: string | null;
  accepted: boolean | null;
  model: string | null;
}) {
  const [checked, setChecked] = useState(Boolean(accepted));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) throw err;
        setError(err instanceof Error ? err.message : "That didn't work.");
      }
    });
  }

  if (!read) {
    return (
      <div className="py-10">
        <p className="display-lead">
          The read uses this week&apos;s numbers and the last four weeks.
        </p>
        <div className="mt-5">
          <Button variant="primary" disabled={pending} onClick={() => run(() => generateCoach(weekStart))}>
            {pending ? "Writing" : "Write the read"}
          </Button>
        </div>
        {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
      </div>
    );
  }

  const [firstLine, ...rest] = read.trim().split("\n");
  const body = rest.join("\n").trim();

  return (
    <div className="mx-auto max-w-[620px] py-6">
      <p className="display-lead leading-[1.3]">{firstLine?.replace(/^#+\s*/, "")}</p>

      {body ? (
        <div className="mt-4 space-y-4 text-[17px] leading-[1.6] text-ink">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: (props) => <p className="mb-4" {...props} />,
              ul: (props) => <ul className="mb-4 list-disc space-y-1 pl-5" {...props} />,
              strong: (props) => <strong className="font-semibold" {...props} />,
            }}
          >
            {body}
          </ReactMarkdown>
        </div>
      ) : null}

      {oneChange ? (
        // Canvas 1q: the one change is boxed in a full-strength ink hairline —
        // the only place on the screen that gets one.
        <div className="mt-6 rounded-card border border-ink p-4">
          <p className="section-label">One change for next week</p>
          <p className="mt-1.5 font-display text-[17px] leading-[1.35] font-medium text-ink">
            {oneChange}
          </p>
          <label className="mt-3 flex min-h-11 items-center gap-2.5 text-[15px] text-ink">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                setChecked(e.target.checked);
                run(() => setOneChangeAccepted(weekStart, e.target.checked));
              }}
              className="size-[22px] rounded-[6px] accent-[var(--ink)]"
            />
            I&apos;ll try this
          </label>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button variant="primary" disabled={pending} onClick={() => run(() => finishReview(weekStart))}>
          Finish
        </Button>
        <button
          onClick={() => run(() => generateCoach(weekStart))}
          disabled={pending}
          className="min-h-11 text-[14px] text-ink-2 underline-offset-2 hover:text-ink hover:underline"
        >
          Regenerate
        </button>
        {model ? <span className="text-[12px] text-ink-3">{model}</span> : null}
      </div>
    </div>
  );
}
