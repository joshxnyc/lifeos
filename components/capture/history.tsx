import { RetryButton } from "@/components/capture/retry-button";
import type { Capture } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  transcribing: "Transcribing",
  filing: "Filing",
  done: "Filed",
  failed: "Failed",
};

/** Recent captures, below the fold on /capture (DESIGN_BRIEF §5.2). */
export function CaptureHistory({ captures }: { captures: Capture[] }) {
  if (!captures.length) return null;

  return (
    <section className="mt-10 border-t border-line pt-6">
      <h2 className="section-label mb-3">Recent captures</h2>
      <ul className="flex flex-col">
        {captures.map((capture) => {
          const line =
            firstLine(capture.cleaned_text) ??
            firstLine(capture.transcript) ??
            firstLine(capture.raw_text) ??
            (capture.audio_path ? "Voice capture" : "Capture");
          const filed = capture.result?.items?.length ?? 0;
          return (
            <li key={capture.id} className="flex items-start justify-between gap-3 border-b border-line py-3">
              <div className="min-w-0">
                <p className="truncate text-[14px] text-ink">{line}</p>
                <p className="mt-0.5 text-[12px] text-ink-2">
                  {STATUS_LABEL[capture.status] ?? capture.status}
                  {capture.status === "done" ? ` · ${filed} ${filed === 1 ? "item" : "items"}` : ""}
                  {capture.status === "failed" && capture.error ? ` · ${capture.error.slice(0, 80)}` : ""}
                </p>
              </div>
              {capture.status === "failed" ? <RetryButton captureId={capture.id} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function firstLine(text: string | null): string | null {
  const line = text?.split("\n").find((l) => l.trim());
  return line ? line.trim().slice(0, 120) : null;
}
