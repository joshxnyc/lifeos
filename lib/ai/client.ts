import "server-only";
import OpenAI from "openai";
import { readFile } from "fs/promises";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEnv, serverEnv } from "@/lib/env";
import { enqueueNotification } from "@/lib/notify";

// SPEC §7 + DECISIONS.md: all LLM traffic goes through OpenRouter on a single
// key (Joshua's call, 2026-09-15). Structured output via forced tool calls;
// every call logged to ai_calls so Settings can show monthly AI spend.
// OpenRouter returns the real cost when usage accounting is requested.

export const MODEL_MAIN = "anthropic/claude-sonnet-5";
export const MODEL_CHEAP = "anthropic/claude-haiku-4.5";
/** Audio-capable model used for voice-capture transcription. */
export const MODEL_AUDIO = "google/gemini-3.8-flash";

/**
 * System message with Anthropic prompt caching (via OpenRouter's cache_control
 * pass-through). The stable prefix — rules + the context block — is reused
 * across every item in an extraction sweep and across back-to-back captures,
 * cutting the repeated input cost by roughly 10x. Volatile text (the item
 * being processed, its random delimiters) always goes in the user message,
 * never here. Non-Anthropic models get the plain string.
 */
function systemMessage(
  model: string,
  system: string,
): OpenAI.Chat.ChatCompletionMessageParam {
  if (!model.startsWith("anthropic/")) return { role: "system", content: system };
  return {
    role: "system",
    content: [
      { type: "text", text: system, cache_control: { type: "ephemeral" } } as never,
    ],
  };
}

/**
 * Daily guardrail (2026-09-17): once today's total spend crosses this, the
 * pipelines that can wait a day are paused until the UTC day rolls over.
 * Roughly 7x a normal day, so it only trips on a runaway (a sync bug
 * re-marking items pending, a pricing change, a prompt gone quadratic).
 */
export const DAILY_AI_BUDGET_USD = 3;

/**
 * Pipelines the guardrail may pause. Everything else — capture filing,
 * transcription, cleanup, the weekly coach — always runs: losing a capture
 * costs more than a day of extra spend.
 */
const BUDGETED_PIPELINES = new Set(["extractCommitments", "proposeTopItem"]);

/** Thrown before a budgeted call; the extract and plan jobs catch it. */
export class DailyAiBudgetError extends Error {
  constructor(spentUsd: number) {
    super(
      `Daily AI budget reached: $${spentUsd.toFixed(2)} spent today (limit $${DAILY_AI_BUDGET_USD})`,
    );
    this.name = "DailyAiBudgetError";
  }
}

/**
 * One indexed query (ai_calls_month_idx covers created_at) summing today's
 * spend, UTC day. Throws DailyAiBudgetError over the limit for budgeted
 * pipelines; a failed check fails open — the guardrail is a cost nicety and
 * must never break a pipeline on its own.
 */
async function enforceDailyBudget(
  supabase: SupabaseClient,
  userId: string,
  pipeline: string,
): Promise<void> {
  if (!BUDGETED_PIPELINES.has(pipeline)) return;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  let spent: number;
  try {
    const { data, error } = await supabase
      .from("ai_calls")
      .select("cost_estimate_usd.sum()")
      .gte("created_at", dayStart.toISOString());
    if (error) throw new Error(error.message);
    spent = Number((data?.[0] as { sum?: number | string } | undefined)?.sum ?? 0) || 0;
  } catch {
    return;
  }
  if (spent < DAILY_AI_BUDGET_USD) return;

  try {
    await enqueueNotification(supabase, userId, {
      kind: "custom",
      title: "AI budget",
      body: `AI spend hit today's $${DAILY_AI_BUDGET_USD} guardrail. Extraction paused until tomorrow.`,
      url: "/settings",
      scheduledFor: new Date(),
      payload: { routine_id: "ai_budget" },
      dedupeDaily: true,
    });
  } catch {
    // the push is best-effort; the stop below is what matters
  }
  throw new DailyAiBudgetError(spent);
}

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
  await enforceDailyBudget(opts.supabase, opts.userId, opts.pipeline);
  const model = opts.model ?? MODEL_MAIN;
  const started = Date.now();

  const response = await openrouter().chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [
      systemMessage(model, opts.system),
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
  await enforceDailyBudget(opts.supabase, opts.userId, opts.pipeline);
  const model = opts.model ?? MODEL_MAIN;
  const started = Date.now();

  const response = await openrouter().chat.completions.create({
    model,
    max_tokens: opts.maxTokens ?? 2048,
    messages: [
      systemMessage(model, opts.system),
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
