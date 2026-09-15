"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Mic, Square } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DomainChip } from "@/components/ui/domain";
import { Waveform } from "@/components/capture/waveform";
import { undoCaptureItem } from "@/app/(app)/capture/actions";
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

const MIME_CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
const EXT: Record<string, string> = { mp4: "m4a", webm: "webm", ogg: "ogg", mpeg: "mp3", wav: "wav" };

export function CapturePanel({ domains, projects }: { domains: Domain[]; projects: Project[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [text, setText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [row, setRow] = useState<CaptureRow | null>(null);
  const [meta, setMeta] = useState<Record<string, RowMeta>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;

  const teardown = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setAnalyser(null);
  }, []);

  useEffect(() => teardown, [teardown]);

  // ---- recording -----------------------------------------------------------

  const startRecording = async () => {
    setProblem(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const node = ctx.createAnalyser();
      node.fftSize = 128;
      ctx.createMediaStreamSource(stream).connect(node);
      setAnalyser(node);

      const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/mp4" });
        teardown();
        void sendAudio(blob);
      };
      recorderRef.current = recorder;
      recorder.start();

      setElapsed(0);
      const started = Date.now();
      timerRef.current = setInterval(() => setElapsed(Date.now() - started), 200);
      setPhase("recording");
    } catch {
      teardown();
      setMode("text");
      setProblem("The microphone is not available. Type the capture instead.");
    }
  };

  const stopRecording = () => {
    setPhase("working");
    recorderRef.current?.stop();
    recorderRef.current = null;
  };

  // ---- sending -------------------------------------------------------------

  const sendAudio = async (blob: Blob) => {
    try {
      const subtype = (blob.type.split("/")[1] ?? "mp4").split(";")[0]!;
      const path = `${crypto.randomUUID()}.${EXT[subtype] ?? "m4a"}`;
      const { error } = await supabase.storage
        .from("captures")
        .upload(path, blob, { contentType: blob.type || "audio/mp4", upsert: false });
      if (error) throw new Error(error.message);

      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audioPath: path, source: isPhone() ? "phone_voice" : "desktop_voice" }),
      });
      const body = (await res.json()) as { captureId?: string; error?: string };
      if (!res.ok || !body.captureId) throw new Error(body.error ?? "Capture failed to save.");
      setCaptureId(body.captureId);
      setRow({ status: "transcribing", transcript: null, cleaned_text: null, result: null, error: null });
    } catch (err) {
      setPhase("idle");
      setProblem(err instanceof Error ? err.message : "Capture failed to save. Try again.");
    }
  };

  const sendText = async () => {
    const value = text.trim();
    if (!value) return;
    setPhase("working");
    setRow({ status: "filing", transcript: value, cleaned_text: value, result: null, error: null });
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: value, source: isPhone() ? "phone_text" : "desktop_text" }),
      });
      const body = (await res.json()) as { captureId?: string; error?: string };
      if (!res.ok || !body.captureId) throw new Error(body.error ?? "Capture failed to save.");
      setText("");
      setCaptureId(body.captureId);
    } catch (err) {
      setPhase("idle");
      setProblem(err instanceof Error ? err.message : "Capture failed to save. Try again.");
    }
  };

  // ---- polling -------------------------------------------------------------

  useEffect(() => {
    if (!captureId || phase === "result") return;
    let cancelled = false;

    const poll = async () => {
      const { data } = await supabase
        .from("captures")
        .select("status, transcript, cleaned_text, result, error")
        .eq("id", captureId)
        .single();
      if (cancelled || !data) return;
      setRow(data as CaptureRow);
      if (data.status === "done" || data.status === "failed") {
        setPhase("result");
        if (data.status === "done") void loadMeta(data.result as CaptureResult | null);
      }
    };

    void poll();
    const id = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [captureId, phase, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!captureId) return;
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
    setPhase("idle");
    setCaptureId(null);
    setRow(null);
    setMeta({});
    setProblem(null);
    setElapsed(0);
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
    return (
      <div className="flex flex-col gap-6 pb-10">
        <section>
          <p className="section-label mb-2">Transcript</p>
          <p className="font-display text-[20px] leading-snug text-ink">
            {row?.cleaned_text || row?.transcript || "Listening back…"}
          </p>
          {filing ? <p className="mt-2 text-[13px] text-ink-2">Filing…</p> : null}
        </section>

        {row?.status === "failed" ? (
          <div className="rounded-card border border-danger/40 p-4">
            <p className="text-[14px] text-ink">{row.error ?? "Filing failed."}</p>
            <p className="mt-1 text-[13px] text-ink-2">The audio is kept. Retry from the history below.</p>
          </div>
        ) : null}

        {result?.needs_clarification ? (
          <p className="rounded-card bg-accent-soft px-3 py-2 text-[13px] text-ink">
            {result.needs_clarification}{" "}
            <Link href={fixHref(result)} className="font-medium text-accent underline underline-offset-2">
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
              <article key={`${item.type}-${item.id}`} className="rounded-card border border-line p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="section-label">{LABELS[item.type]}</p>
                    <p className="mt-1 text-[15px] text-ink">{item.title}</p>
                    {item.detail ? <p className="mt-0.5 text-[13px] text-ink-2">{item.detail}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {domain ? <DomainChip slug={domain.slug as DomainSlug} name={domain.name} /> : null}
                      {project ? (
                        <span className="rounded-full border border-line px-2 py-0.5 text-[12px] text-ink-2">
                          {project.name}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {item.id ? (
                    <button
                      onClick={() => undo(item.id!, item.type)}
                      className="h-11 shrink-0 px-2 text-[13px] text-ink-2 hover:text-ink"
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

      {mode === "text" ? (
        <div className="flex flex-1 flex-col gap-3">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What's on your mind?"
            rows={6}
            className="w-full resize-none rounded-card border border-line bg-paper-2 p-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void sendText();
            }}
          />
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={() => void sendText()} disabled={!text.trim()}>
              Send
            </Button>
            <button onClick={() => setMode("voice")} className="h-11 text-[13px] text-ink-2 hover:text-ink">
              Record instead
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-end gap-6 pb-safe">
          <div className="w-full max-w-sm">
            <Waveform analyser={analyser} active={phase === "recording"} />
            <p className="mt-2 text-center text-[13px] tabular text-ink-2">
              {phase === "recording" ? formatElapsed(elapsed) : "Tap to record"}
            </p>
          </div>

          <button
            onClick={() => (phase === "recording" ? stopRecording() : void startRecording())}
            aria-label={phase === "recording" ? "Stop recording" : "Record"}
            className={cn(
              "flex size-24 items-center justify-center rounded-full text-white shadow-whisper transition-colors",
              phase === "recording" ? "bg-danger" : "bg-accent",
            )}
          >
            {phase === "recording" ? <Square className="size-8" /> : <Mic className="size-9" />}
          </button>

          <button onClick={() => setMode("text")} className="h-11 text-[14px] text-ink-2 hover:text-ink">
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
};

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
