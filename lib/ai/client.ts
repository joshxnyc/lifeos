import "server-only";
import OpenAI from "openai";
import { readFile } from "fs/promises";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEnv, serverEnv } from "@/lib/env";

// SPEC §7 + DECISIONS.md: all LLM traffic goes through OpenRouter on a single
// key (Joshua's call, 2026-09-15). Structured output via forced tool calls;
// every call logged to ai_calls so Settings can show monthly AI spend.
// OpenRouter returns the real cost when usage accounting is requested.

export const MODEL_MAIN = "anthropic/claude-sonnet-5";
export const MODEL_CHEAP = "anthropic/claude-haiku-4.5";
/** Audio-capable model used for voice-capture transcription. */
export const MODEL_AUDIO = "google/gemini-3.8-flash";

let client: OpenAI | null = null;
export function openrouter(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: requireEnv("OPENROUTER_API_KEY"),
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": serverEnv().APP_URL,
        "X-Title": "LifeOS",
      },
    });
  }
  return client;
}

/**
 * Prompts live in /lib/ai/prompts/*.md as files, not inline strings
 * (SPEC §7). `vars` fills {{placeholders}}.
 */
export async function loadPrompt(name: string, vars: Record<string, string> = {}): Promise<string> {
  const file = path.join(process.cwd(), "lib", "ai", "prompts", `${name}.md`);
  let text = await readFile(file, "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{{${k}}}`, v);
  return text;
}

interface UsageWithCost {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
}

async function logCall(
  supabase: SupabaseClient,
  userId: string,
  pipeline: string,
  model: string,
  usage: UsageWithCost | undefined,
  latencyMs: number,
  refId?: string,
) {
  await supabase.from("ai_calls").insert({
    user_id: userId,
    pipeline,
    model,
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
    latency_ms: latencyMs,
    cost_estimate_usd: usage?.cost ?? 0,
    ref_id: refId ?? null,
  });
}

export interface StructuredCallOptions {
  pipeline: string; // logged to ai_calls
  model?: string;
  system: string;
  userContent: string;
  toolName: string;
  toolDescription: string;
  /** JSON schema for the desired output (the tool's parameters). */
  schema: Record<string, unknown>;
  maxTokens?: number;
  supabase: SupabaseClient;
  userId: string;
  refId?: string;
}

/**
 * One structured LLM call: a single tool whose parameter schema is the
 * desired JSON, forced with tool_choice. Returns the parsed arguments.
 */
export async function callStructured<T>(opts: StructuredCallOptions): Promise<T> {
  const model = opts.model ?? MODEL_MAIN;
  const started = Date.now();

  const response = await openrouter().chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.userContent },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: opts.toolName,
          description: opts.toolDescription,
          parameters: opts.schema,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: opts.toolName } },
    // OpenRouter usage accounting: response.usage.cost is the actual charge.
    // @ts-expect-error OpenRouter extension not in the OpenAI types
    usage: { include: true },
  });

  await logCall(
    opts.supabase,
    opts.userId,
    opts.pipeline,
    model,
    response.usage as UsageWithCost | undefined,
    Date.now() - started,
    opts.refId,
  );

  const call = response.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") {
    throw new Error(
      `AI pipeline ${opts.pipeline}: no tool call (finish: ${response.choices[0]?.finish_reason})`,
    );
  }
  try {
    return JSON.parse(call.function.arguments) as T;
  } catch {
    throw new Error(`AI pipeline ${opts.pipeline}: tool arguments were not valid JSON`);
  }
}

/**
 * Plain-text call (transcript cleanup, coach prose). Also logged to ai_calls.
 */
export async function callText(opts: {
  pipeline: string;
  model?: string;
  system: string;
  userContent: string;
  maxTokens?: number;
  supabase: SupabaseClient;
  userId: string;
  refId?: string;
}): Promise<string> {
  const model = opts.model ?? MODEL_MAIN;
  const started = Date.now();

  const response = await openrouter().chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 2048,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.userContent },
    ],
    // @ts-expect-error OpenRouter extension not in the OpenAI types
    usage: { include: true },
  });

  await logCall(
    opts.supabase,
    opts.userId,
    opts.pipeline,
    model,
    response.usage as UsageWithCost | undefined,
    Date.now() - started,
    opts.refId,
  );

  return response.choices[0]?.message?.content ?? "";
}

/**
 * Transcribe audio through OpenRouter with an audio-capable model. Used by
 * lib/transcribe.ts; the `prompt` carries domain/project/people names for
 * proper-noun accuracy (SPEC §7.1).
 */
export async function transcribeViaOpenRouter(opts: {
  audio: Buffer;
  mime: string; // audio/mp4 (Safari) | audio/webm (Chrome) | audio/wav ...
  prompt: string;
  supabase: SupabaseClient;
  userId: string;
  refId?: string;
}): Promise<string> {
  const started = Date.now();
  const format = opts.mime.includes("mp4")
    ? "m4a"
    : opts.mime.includes("webm")
      ? "webm"
      : opts.mime.includes("mpeg") || opts.mime.includes("mp3")
        ? "mp3"
        : "wav";

  const response = await openrouter().chat.completions.create({
    model: MODEL_AUDIO,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content:
          "You are a transcription engine. Transcribe the audio verbatim in its original language. Output only the transcript text — no preamble, no timestamps, no speaker labels.\n" +
          `Names and terms likely to appear: ${opts.prompt}`,
      },
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: { data: opts.audio.toString("base64"), format },
          } as never,
        ],
      },
    ],
    // @ts-expect-error OpenRouter extension not in the OpenAI types
    usage: { include: true },
  });

  await logCall(
    opts.supabase,
    opts.userId,
    "transcribe",
    MODEL_AUDIO,
    response.usage as UsageWithCost | undefined,
    Date.now() - started,
    opts.refId,
  );

  return (response.choices[0]?.message?.content ?? "").trim();
}
