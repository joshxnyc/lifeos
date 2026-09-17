"use client";

// Record from anywhere: the tab-bar mic (and the palette's Record command)
// dispatch RECORD_EVENT instead of navigating, this sheet slides up over the
// current page, and the result lands as a toast — Joshua never leaves the
// screen he was on. Mounted once in the app shell.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Square, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/tasks/toast";
import { Waveform } from "@/components/capture/waveform";
import { FilingIndicator } from "@/components/capture/filing-indicator";
import { formatElapsed, useRecorder } from "@/components/capture/use-recorder";
import { isPhone, postCapture, uploadAudio } from "@/components/capture/send";
import { waitForCaptureRow } from "@/components/capture/wait";
import { summarizeCapture } from "@/components/capture/use-smart-add";
import { isNetworkError, queueCapture } from "@/components/capture/offline-queue";

const RECORD_EVENT = "lifeos:record";

/** Ask the globally mounted sheet to start recording on the current page. */
export function requestRecord(): void {
  window.dispatchEvent(new Event(RECORD_EVENT));
}

// Audio takes real time (transcribe, then file); poll patiently before
// declaring it a background job.
const POLL_MS = 1500;
const MAX_WAIT_MS = 120_000;

export function GlobalRecord() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { recording, elapsedMs, analyser, start, stop, cancel } = useRecorder();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [filing, setFiling] = useState(false);

  const begin = useCallback(async () => {
    if (recording || filing) return;
    const ok = await start();
    if (!ok) {
      toast("The microphone is not available. Type it on the capture screen instead.");
      return;
    }
    setSheetOpen(true);
  }, [recording, filing, start]);

  useEffect(() => {
    const onRecord = () => void begin();
    window.addEventListener(RECORD_EVENT, onRecord);
    return () => window.removeEventListener(RECORD_EVENT, onRecord);
  }, [begin]);

  const finish = async () => {
    setSheetOpen(false);
    const blob = await stop();
    if (!blob || blob.size === 0) return;

    const source = isPhone() ? "phone_voice" : "desktop_voice";
    setFiling(true);
    try {
      const path = await uploadAudio(supabase, blob);
      const captureId = await postCapture({ audioPath: path, source });
      const row = await waitForCaptureRow(supabase, captureId, {
        pollMs: POLL_MS,
        maxWaitMs: MAX_WAIT_MS,
      });
      router.refresh();
      if (!row) {
        toast("Still filing. It finishes in the background.");
      } else if (row.status === "failed") {
        toast(row.error ?? "Could not file that. Retry from the capture screen.");
      } else {
        const summary = summarizeCapture(row.result);
        const clarification = row.result?.needs_clarification?.trim();
        toast(clarification ? `${summary}. ${clarification}` : summary);
      }
    } catch (err) {
      if (isNetworkError(err)) {
        const outcome = await queueCapture({ source, audio: blob, audioType: blob.type });
        toast(
          outcome === "stored"
            ? "Saved offline. Will send when back online."
            : "Saved offline in this tab only. Keep it open until you are back online.",
        );
      } else {
        toast(err instanceof Error ? err.message : "Capture failed to save. Try again.");
      }
    } finally {
      setFiling(false);
    }
  };

  const dismiss = () => {
    cancel();
    setSheetOpen(false);
  };

  return (
    <>
      {sheetOpen ? (
        <div className="animate-fade-in fixed inset-0 z-[60] bg-ink/20" onClick={dismiss}>
          <div
            role="dialog"
            aria-label="Recording"
            onClick={(e) => e.stopPropagation()}
            className="animate-sheet-up absolute inset-x-0 bottom-0 rounded-t-2xl bg-paper px-5 pt-4 pb-safe shadow-whisper supports-[backdrop-filter]:bg-paper/90 supports-[backdrop-filter]:backdrop-blur-xl"
          >
            <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-line" aria-hidden />
            <div className="mx-auto flex w-full max-w-sm flex-col items-center pb-6">
              <p className="tabular mb-3 font-mono text-[13px] text-ink-2">
                {recording ? formatElapsed(elapsedMs) : "0:00"}
              </p>
              <Waveform analyser={analyser} active={recording} />

              <div className="mt-7 flex w-full items-center justify-center gap-8">
                <button
                  type="button"
                  onClick={dismiss}
                  aria-label="Discard recording"
                  className="flex size-12 items-center justify-center rounded-full border border-line text-ink-2 transition-transform active:scale-95"
                >
                  <X className="size-5" />
                </button>
                <button
                  type="button"
                  onClick={() => void finish()}
                  aria-label="Stop and file"
                  className="flex size-[76px] items-center justify-center rounded-full bg-accent text-paper shadow-whisper transition-transform active:scale-95"
                >
                  <Square className="size-6" />
                </button>
                {/* Mirror spacer keeps the stop button centred. */}
                <span className="size-12" aria-hidden />
              </div>
              <p className="mt-3 text-[13px] text-ink-2">Tap to stop and file</p>

              <Link
                href="/capture"
                onClick={dismiss}
                className="mt-5 flex h-11 items-center text-[14px] text-accent"
              >
                Type instead
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {filing ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center md:bottom-8">
          <span className="animate-sheet-up flex items-center rounded-full border border-line bg-raise px-4 py-2 text-[13px] text-ink shadow-whisper supports-[backdrop-filter]:bg-raise/85 supports-[backdrop-filter]:backdrop-blur-xl">
            <FilingIndicator label="Filing your capture…" />
          </span>
        </div>
      ) : null}
    </>
  );
}
