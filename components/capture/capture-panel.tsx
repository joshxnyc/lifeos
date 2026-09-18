"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Mic, Square } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { DomainChip } from "@/components/ui/domain";
import { toast } from "@/components/tasks/toast";
import { Waveform } from "@/components/capture/waveform";
import { CaptureProgress } from "@/components/capture/progress-steps";
import {
  formatElapsed,
  RECORDING_COUNTDOWN_FROM_MS,
  RECORDING_LIMIT_MS,
  useRecorder,
} from "@/components/capture/use-recorder";
import { isPhone, postCapture, uploadAudio } from "@/components/capture/send";
import { undoCaptureItem } from "@/app/(app)/capture/actions";
import {
  isNetworkError,
  listQueued,
  queueCapture,
  removeQueued,
  withFlushLock,
} from "@/components/capture/offline-queue";
import type { CaptureResult, Domain, DomainSlug, Project } from "@/lib/types";

type Phase = "idle" | "recording" | "working" | "result";

interface CaptureRow {
  status: string;
  transcript: string | null;
  cleaned_text: string | null;
  result: CaptureResult | null;
  error: string | null;
}

interface RowMeta {
  domain_id: string | null;
  project_id: string | null;
  due_date?: string | null;
  due_time?: string | null;
}

// Poll fast while it is plausibly about to finish, then back off so a long
// transcription does not hammer the row for half a minute.
const POLL_FAST_MS = 1000;
const POLL_SLOW_MS = 2500;
const POLL_BACKOFF_AFTER_MS = 10_000;
/** No status change for this long: say so, and stop implying it is stuck. */
const STALL_AFTER_MS = 45_000;

export function CapturePanel({
  domains,
  projects,
  initialCaptureId = null,
}: {
  domains: Domain[];
  projects: Project[];
  /** ?capture=<id>: hydrate straight into that capture's result view (the
   * "Review" action on the global record sheet's toast lands here). */
  initialCaptureId?: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  // The 5 minute ceiling flows through the same stopRecording() as a tap on
  // the stop button, so the audio is uploaded and filed — never discarded.
  const recorder = useRecorder({
    onAutoStop: () => {
      toast("Recording hit the 5 minute limit. Filed what was captured.");
      void stopRecording();
    },
  });
  const [phase, setPhase] = useState<Phase>(initialCaptureId ? "working" : "idle");
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [text, setText] = useState("");
  const [captureId, setCaptureId] = useState<string | null>(initialCaptureId);
  const [row, setRow] = useState<CaptureRow | null>(null);
  const [meta, setMeta] = useState<Record<string, RowMeta>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [offlineNote, setOfflineNote] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Processing clock: when work started, when the status last moved, and a
  // once-a-second tick so both read as live without touching the poll loop.
  const [workStartedAt, setWorkStartedAt] = useState<number | null>(() =>
    initialCaptureId ? Date.now() : null,
  );
  const [statusChangedAt, setStatusChangedAt] = useState<number | null>(() =>
    initialCaptureId ? Date.now() : null,
  );
  const [tick, setTick] = useState(() => Date.now());
  const lastStatusRef = useRef<string | null>(null);

  // ---- recording -----------------------------------------------------------

  const startRecording = async () => {
    setProblem(null);
    setOfflineNote(null);
    const ok = await recorder.start();
    if (!ok) {
      setMode("text");
      setProblem("The microphone is not available. Type the capture instead.");
      return;
    }
    setPhase("recording");
  };

  /** Start the processing clock the progress strip reads from. */
  const beginWork = useCallback(() => {
    const now = Date.now();
    lastStatusRef.current = null;
    setWorkStartedAt(now);
    setStatusChangedAt(now);
    setTick(now);
  }, []);

  const stopRecording = async () => {
    setPhase("working");
    beginWork();
    const blob = await recorder.stop();
    if (blob && blob.size) void sendAudio(blob);
    else setPhase("idle");
  };

  // Already mounted when a Review link lands (?capture=<id> while on /capture):
  // switch to that capture without losing an in-progress recording.
  useEffect(() => {
    if (!initialCaptureId || initialCaptureId === captureId) return;
    if (phase === "recording") return;
    setCaptureId(initialCaptureId);
    setRow(null);
    setMeta({});
    setProblem(null);
    setOfflineNote(null);
    setPhase("working");
    beginWork();
  }, [initialCaptureId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- sending -------------------------------------------------------------

  /** Park a capture the network refused, and say where it went. */
  const parkOffline = async (item: { source: string; text?: string; audio?: Blob }) => {
    const outcome = await queueCapture({
      source: item.source,
      text: item.text,
      audio: item.audio,
      audioType: item.audio?.type,
    });
    setProblem(null);
    setOfflineNote(
      outcome === "stored"
        ? "Saved offline. Will send when back online."
        : "Saved offline in this tab only. Keep it open until you are back online.",
    );
  };

  const sendAudio = async (blob: Blob) => {
    const source = isPhone() ? "phone_voice" : "desktop_voice";
    try {
      const path = await uploadAudio(supabase, blob);
      const id = await postCapture({ audioPath: path, source });
      setCaptureId(id);
      setRow({ status: "transcribing", transcript: null, cleaned_text: null, result: null, error: null });
    } catch (err) {
      setPhase("idle");
      if (isNetworkError(err)) {
        await parkOffline({ source, audio: blob });
        return;
      }
      setProblem(err instanceof Error ? err.message : "Capture failed to save. Try again.");
    }
  };

  const sendText = async () => {
    const value = text.trim();
    if (!value) return;
    const source = isPhone() ? "phone_text" : "desktop_text";
    setPhase("working");
    beginWork();
    setRow({ status: "filing", transcript: value, cleaned_text: value, result: null, error: null });
    try {
      const id = await postCapture({ text: value, source });
      setText("");
      setCaptureId(id);
    } catch (err) {
      setPhase("idle");
      if (isNetworkError(err)) {
        setText("");
        setRow(null);
        await parkOffline({ source, text: value });
        return;
      }
      setProblem(err instanceof Error ? err.message : "Capture failed to save. Try again.");
    }
  };

  // ---- offline queue -------------------------------------------------------

  /**
   * Replay whatever the network ate, on mount and whenever the browser says it
   * is back. A capture the server rejects on its merits is dropped with a note
   * rather than retried forever.
   */
  const flushQueue = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    // withFlushLock also excludes the shell flusher (app-lifecycle): arriving
    // here while it is mid-flight must not send the same queued items twice.
    await withFlushLock(async () => {
      const items = await listQueued();
      if (!items.length) return;

      let sent = 0;
      let rejected: string | null = null;
      for (const item of items) {
        try {
          if (item.audio) {
            const path = await uploadAudio(supabase, item.audio);
            await postCapture({ audioPath: path, source: item.source });
          } else if (item.text) {
            await postCapture({ text: item.text, source: item.source });
          } else {
            await removeQueued(item.id);
            continue;
          }
          await removeQueued(item.id);
          sent += 1;
        } catch (err) {
          if (isNetworkError(err)) break; // still offline: leave the rest queued
          rejected = err instanceof Error ? err.message : "Capture failed to save.";
          await removeQueued(item.id);
        }
      }

      if (sent) setOfflineNote(`${sent} offline ${sent === 1 ? "capture" : "captures"} sent.`);
      if (rejected) setProblem(`An offline capture could not be filed: ${rejected}`);
    });
  }, [supabase]);

  useEffect(() => {
    void flushQueue();
    const onOnline = () => void flushQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushQueue]);

  // ---- polling -------------------------------------------------------------

  useEffect(() => {
    if (!captureId || phase === "result") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const poll = async () => {
      const { data } = await supabase
        .from("captures")
        .select("status, transcript, cleaned_text, result, error")
        .eq("id", captureId)
        .single();
      if (cancelled) return;
      if (data) {
        setRow(data as CaptureRow);
        const status = data.status as string;
        if (status !== lastStatusRef.current) {
          lastStatusRef.current = status;
          setStatusChangedAt(Date.now());
        }
        if (status === "done" || status === "failed") {
          setPhase("result");
          if (status === "done") void loadMeta(data.result as CaptureResult | null);
          return;
        }
      }
      const delay = Date.now() - startedAt < POLL_BACKOFF_AFTER_MS ? POLL_FAST_MS : POLL_SLOW_MS;
      timer = setTimeout(() => void poll(), delay);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [captureId, phase, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once-a-second re-render so the elapsed count and the 45-second note move.
  useEffect(() => {
    if (!workStartedAt || phase === "idle" || phase === "recording") return;
    if (row?.status === "done" || row?.status === "failed") return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [workStartedAt, phase, row?.status]);

  const loadMeta = async (result: CaptureResult | null) => {
    const taskIds = (result?.items ?? [])
      .filter((i) => i.type === "task" || i.type === "reminder")
      .map((i) => i.id!)
      .filter(Boolean);
    const noteIds = (result?.items ?? []).filter((i) => i.type === "note").map((i) => i.id!).filter(Boolean);
    const next: Record<string, RowMeta> = {};
    if (taskIds.length) {
      const { data } = await supabase
        .from("tasks")
        .select("id, domain_id, project_id, due_date, due_time")
        .in("id", taskIds);
      for (const t of data ?? []) next[t.id] = t as RowMeta;
    }
    if (noteIds.length) {
      const { data } = await supabase.from("notes").select("id, domain_id, project_id").in("id", noteIds);
      for (const n of data ?? []) next[n.id] = n as RowMeta;
    }
    setMeta(next);
  };

  // ---- result helpers ------------------------------------------------------

  const domainById = useMemo(() => new Map(domains.map((d) => [d.id, d])), [domains]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const undo = (itemId: string, type: CaptureResult["items"][number]["type"]) => {
    // task_edit changed a task in place — nothing was created, nothing to undo.
    // The button is hidden for edits; this guard keeps the types honest too.
    if (!captureId || type === "task_edit") return;
    setRow((prev) =>
      prev?.result
        ? { ...prev, result: { ...prev.result, items: prev.result.items.filter((i) => i.id !== itemId) } }
        : prev,
    );
    startTransition(async () => {
      await undoCaptureItem({ captureId, itemId, type });
    });
  };

  const reset = () => {
    // Drop a ?capture= param so a reload does not resurrect the result view.
    if (typeof window !== "undefined" && window.location.search.includes("capture=")) {
      window.history.replaceState(null, "", "/capture");
    }
    setPhase("idle");
    setCaptureId(null);
    setRow(null);
    setMeta({});
    setProblem(null);
    setOfflineNote(null);
    setWorkStartedAt(null);
    setStatusChangedAt(null);
    lastStatusRef.current = null;
  };

  const fixHref = (result: CaptureResult | null): string => {
    const item = result?.items[0];
    if (!item?.id) return "/tasks";
    if (item.type === "note") return `/notes/${item.id}`;
    if (item.type === "person_update") return `/people/${item.id}`;
    return `/tasks?task=${item.id}`;
  };

  // ---- render --------------------------------------------------------------

  if (phase === "working" || phase === "result") {
    const result = row?.result ?? null;
    const filing = row?.status !== "done" && row?.status !== "failed";
    const workElapsed = workStartedAt ? Math.max(0, Math.round((tick - workStartedAt) / 1000)) : 0;
    const stalled = filing && statusChangedAt !== null && tick - statusChangedAt > STALL_AFTER_MS;
    return (
      <div className="flex flex-col gap-6 pb-10">
        <section>
          <p className="sr-only">Transcript</p>
          {/* Canvas 1d: the transcript reads as a quotation in Fraunces. */}
          <p className="font-display text-[20px] leading-[1.35] text-ink">
            {row?.cleaned_text || row?.transcript
              ? `\u201C${row?.cleaned_text || row?.transcript}\u201D`
              : "Listening back…"}
          </p>
          {row?.status !== "failed" ? (
            <CaptureProgress status={row?.status} elapsedSeconds={workElapsed} stalled={stalled} />
          ) : null}
        </section>

        {row?.status === "failed" ? (
          <div className="rounded-card border border-danger/40 p-4">
            <p className="text-[14px] text-ink">{row.error ?? "Filing failed."}</p>
            <p className="mt-1 text-[13px] text-ink-2">The audio is kept. Retry from the history below.</p>
          </div>
        ) : null}

        {result?.needs_clarification ? (
          // Canvas 1d: a quiet paper-2 strip, the fix as an accent action.
          <p className="flex items-start justify-between gap-3 rounded-card bg-paper-2 px-3 py-2.5 text-[13px] text-ink-2">
            <span>{result.needs_clarification}</span>
            <Link href={fixHref(result)} className="shrink-0 font-medium text-accent">
              Fix
            </Link>
          </p>
        ) : null}

        <section className="flex flex-col gap-3">
          {(result?.items ?? []).map((item) => {
            const rowMeta = item.id ? meta[item.id] : undefined;
            const domain = rowMeta?.domain_id ? domainById.get(rowMeta.domain_id) : undefined;
            const project = rowMeta?.project_id ? projectById.get(rowMeta.project_id) : undefined;
            return (
              <article
                key={`${item.type}-${item.id}`}
                className="rounded-card border border-line bg-raise p-3.5 shadow-whisper"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="section-label">{LABELS[item.type]}</p>
                    <p className="mt-1.5 text-[15px] font-medium text-ink">{item.title}</p>
                    {item.detail ? <p className="mt-0.5 text-[13px] text-ink-2">{item.detail}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {domain ? <DomainChip slug={domain.slug as DomainSlug} name={domain.name} /> : null}
                      {project ? (
                        <span className="rounded-full bg-paper-2 px-2.5 py-0.5 text-[13px] text-ink">
                          {project.name}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {/* An edit changed a task in place; there is no created row to
                      undo, so the affordance would only mislead. */}
                  {item.id && item.type !== "task_edit" ? (
                    <button
                      onClick={() => undo(item.id!, item.type)}
                      className="h-11 shrink-0 px-2 text-[13px] text-accent"
                    >
                      Undo
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
          {!filing && !(result?.items ?? []).length && row?.status === "done" ? (
            <p className="text-[14px] text-ink-2">Nothing to file from that one.</p>
          ) : null}
        </section>

        <div>
          <Button variant="primary" onClick={reset}>
            Capture another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[64vh] flex-col">
      {problem ? <p className="mb-4 text-[13px] text-danger">{problem}</p> : null}
      {offlineNote ? <p className="mb-4 text-[13px] text-ink-2">{offlineNote}</p> : null}

      {mode === "text" ? (
        <div className="flex flex-1 flex-col gap-3">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What's on your mind?"
            rows={6}
            className="w-full resize-none rounded-card bg-paper-2 p-3.5 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:ring-1 focus:ring-accent"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void sendText();
            }}
          />
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={() => void sendText()} disabled={!text.trim()}>
              Send
            </Button>
            <button onClick={() => setMode("voice")} className="h-11 text-[14px] text-accent">
              Record instead
            </button>
          </div>
        </div>
      ) : (
        // Canvas 1c: elapsed time over the waveform, the 96px accent button
        // under it, then what a tap does, then the way out.
        <div className="flex flex-1 flex-col items-center justify-end gap-0 pb-safe">
          <div className="w-full max-w-sm">
            <p className="tabular mb-4 text-center font-mono text-[13px] text-ink-2">
              {phase === "recording" ? formatElapsed(recorder.elapsedMs) : "0:00"}
            </p>
            {phase === "recording" && recorder.elapsedMs >= RECORDING_COUNTDOWN_FROM_MS ? (
              <p className="tabular -mt-3 mb-4 text-center font-mono text-[13px] text-ink-2">
                Stops in {formatElapsed(Math.max(0, RECORDING_LIMIT_MS - recorder.elapsedMs))}
              </p>
            ) : null}
            <Waveform analyser={recorder.analyser} active={phase === "recording"} />
          </div>

          <button
            onClick={() => (phase === "recording" ? void stopRecording() : void startRecording())}
            aria-label={phase === "recording" ? "Stop recording" : "Record"}
            className="mt-10 flex size-24 items-center justify-center rounded-full bg-accent text-paper shadow-whisper transition-transform active:scale-95"
          >
            {phase === "recording" ? <Square className="size-7" /> : <Mic className="size-9" />}
          </button>

          <p className="mt-3.5 text-[13px] text-ink-2">
            {phase === "recording" ? "Tap to stop" : "Tap to record"}
          </p>

          <button onClick={() => setMode("text")} className="mt-8 h-11 text-[15px] text-accent">
            Type instead
          </button>
        </div>
      )}
    </div>
  );
}

const LABELS: Record<string, string> = {
  task: "Task",
  reminder: "Reminder",
  note: "Note",
  routine_log: "Routine logged",
  person_update: "Person update",
  task_edit: "Task updated",
};
