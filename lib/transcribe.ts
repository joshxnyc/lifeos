import "server-only";
import OpenAI, { toFile } from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL_AUDIO, transcribeViaOpenRouter } from "@/lib/ai/client";
import { serverEnv } from "@/lib/env";

/**
 * Audio transcription for voice captures (SPEC §7.1).
 *
 * Per DECISIONS.md (2026-09-15, Joshua): one LLM key via OpenRouter, so
 * transcription runs on the audio-capable chat model rather than a Whisper
 * endpoint. Direct OpenAI Whisper stays as a dormant fallback and is used only
 * when `OPENAI_API_KEY` is set — the escape hatch if Safari `audio/mp4` or
 * Chrome `audio/webm` clips come back poorly.
 */

const MIME_EXT: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

/** File extension for a recorder mime type; defaults to m4a (Safari's). */
export function extForMime(mime: string | null | undefined): string {
  if (!mime) return "m4a";
  const base = mime.split(";")[0]!.trim().toLowerCase();
  return MIME_EXT[base] ?? "m4a";
}

/** Recorder mime type for a stored file extension (the reverse trip). */
export function mimeForExt(ext: string): string {
  const found = Object.entries(MIME_EXT).find(([, e]) => e === ext.toLowerCase());
  return found?.[0] ?? "audio/mp4";
}

const FALLBACK_MODEL = "whisper-1";

/** The transcription hint is a short name list, not context: keep it small. */
const MAX_PROMPT_CHARS = 900;

let openaiClient: OpenAI | null = null;
function openai(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: serverEnv().OPENAI_API_KEY });
  return openaiClient;
}

export interface TranscriptionResult {
  text: string;
  model: string;
}

/**
 * Transcribe recorded audio.
 *
 * @param audio  raw bytes as uploaded by the browser
 * @param mime   the recorder's mime type (audio/mp4 | audio/webm | …)
 * @param prompt domain, project and people names — improves proper-noun
 *               accuracy ("Bernhard Niesner", "Almedia", "Tarifa") per SPEC §7.1
 */
export async function transcribeAudio(opts: {
  audio: Buffer;
  mime: string;
  prompt?: string;
  supabase: SupabaseClient;
  userId: string;
  refId?: string;
}): Promise<TranscriptionResult> {
  const hint = opts.prompt?.slice(0, MAX_PROMPT_CHARS) ?? "";
  // Audio is sent base64-inline to OpenRouter, so cap it: ~20MB of m4a is far
  // longer than any capture Joshua records on the move.
  if (opts.audio.byteLength > 20_000_000) {
    throw new Error("Recording is too long to transcribe. Record it in shorter pieces.");
  }

  let primaryError: string;
  try {
    const text = await transcribeViaOpenRouter({
      audio: opts.audio,
      mime: opts.mime,
      prompt: hint,
      supabase: opts.supabase,
      userId: opts.userId,
      refId: opts.refId,
    });
    if (text.trim()) return { text: text.trim(), model: MODEL_AUDIO };
    primaryError = "empty transcript";
  } catch (err) {
    primaryError = err instanceof Error ? err.message : String(err);
  }

  if (!serverEnv().OPENAI_API_KEY) {
    throw new Error(`Transcription failed (${MODEL_AUDIO}: ${primaryError})`);
  }

  try {
    // OpenAI picks the decoder from the filename, so the extension must match.
    const file = await toFile(opts.audio, `capture.${extForMime(opts.mime)}`, { type: opts.mime });
    const res = await openai().audio.transcriptions.create({
      file,
      model: FALLBACK_MODEL,
      prompt: hint || undefined,
    });
    return { text: (res.text ?? "").trim(), model: FALLBACK_MODEL };
  } catch (err) {
    const second = err instanceof Error ? err.message : String(err);
    throw new Error(`Transcription failed (${MODEL_AUDIO}: ${primaryError}; ${FALLBACK_MODEL}: ${second})`);
  }
}

/**
 * Proper-noun hint for the transcriber: domain, project and people names.
 * Built from the same tables as buildContext(), but names only.
 */
export function transcriptionPrompt(names: {
  domains: string[];
  projects: string[];
  people: string[];
  routines: string[];
}): string {
  const all = [...names.domains, ...names.projects, ...names.people, ...names.routines]
    .map((n) => n.trim())
    .filter(Boolean);
  return Array.from(new Set(all)).join(", ").slice(0, MAX_PROMPT_CHARS);
}
