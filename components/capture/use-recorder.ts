"use client";

// The one MediaRecorder wrapper: mic + analyser + elapsed clock, with a
// promise-shaped stop. Used by the capture screen's panel and by the global
// record sheet, so recording behaves identically everywhere.

import { useCallback, useEffect, useRef, useState } from "react";

/** Safari records audio/mp4, Chrome audio/webm — try in preference order. */
const MIME_CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"];

/** Hard ceiling: transcription cost and iOS background limits both bite past
 * this. At the limit the hook fires `onAutoStop` — it never stops the recorder
 * itself, so the owning UI runs its normal stop-and-file path and the audio is
 * kept, exactly as if the stop button had been tapped. */
export const RECORDING_LIMIT_MS = 5 * 60_000;
/** The UIs show a "Stops in 0:42" countdown from here on. */
export const RECORDING_COUNTDOWN_FROM_MS = 4 * 60_000;

export function useRecorder(opts?: { onAutoStop?: () => void }) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((blob: Blob | null) => void) | null>(null);
  const discardRef = useRef(false);

  const teardown = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setAnalyser(null);
  }, []);

  // Unmount while recording: stop the hardware, resolve any waiter with null.
  useEffect(
    () => () => {
      discardRef.current = true;
      try {
        recorderRef.current?.stop();
      } catch {
        // already stopped
      }
      recorderRef.current = null;
      teardown();
    },
    [teardown],
  );

  /** Resolves false when the microphone is unavailable or permission denied. */
  const start = useCallback(async (): Promise<boolean> => {
    if (recorderRef.current) return true;
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
      discardRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = discardRef.current
          ? null
          : new Blob(chunksRef.current, { type: recorder.mimeType || "audio/mp4" });
        chunksRef.current = [];
        teardown();
        resolveRef.current?.(blob);
        resolveRef.current = null;
      };
      recorderRef.current = recorder;
      recorder.start();

      setElapsedMs(0);
      const started = Date.now();
      timerRef.current = setInterval(() => setElapsedMs(Date.now() - started), 200);
      setRecording(true);
      return true;
    } catch {
      teardown();
      return false;
    }
  }, [teardown]);

  /** Stop and hand back the audio. Null when nothing was recording. */
  const stop = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder) return Promise.resolve(null);
    recorderRef.current = null;
    setRecording(false);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      recorder.stop();
    });
  }, []);

  /** Stop and throw the audio away. */
  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (!recorder) return;
    discardRef.current = true;
    recorder.stop();
  }, []);

  return { recording, elapsedMs, analyser, start, stop, cancel };
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
