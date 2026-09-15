import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "fs/promises";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

// SPEC §7: all LLM calls use tool use for structured output, and every call
// is logged to ai_calls so Settings can show monthly AI spend.

// SPEC §3 names "current Sonnet" for extraction/filing/coach and Haiku for
// cheap classification. Keep ids here so a model bump is a one-line change.
export const MODEL_MAIN = "claude-sonnet-5";
export const MODEL_CHEAP = "claude-haiku-4-5";

// USD per 1M tokens (input, output) — for the ai_calls cost estimate only.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
};

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: serverEnv().ANTHROPIC_API_KEY });
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

export interface StructuredCallOptions {
  pipeline: string; // logged to ai_calls
  model?: string;
  system: string;
  userContent: string;
  toolName: string;
  toolDescription: string;
  /** JSON schema for the desired output (the tool's input schema). */
  schema: Record<string, unknown>;
  maxTokens?: number;
  supabase: SupabaseClient;
  userId: string;
  refId?: string;
}

/**
 * One structured LLM call: a single tool whose input schema is the desired
 * JSON, forced with tool_choice, thinking disabled for deterministic
 * extraction. Returns the parsed tool input.
 */
export async function callStructured<T>(opts: StructuredCallOptions): Promise<T> {
  const model = opts.model ?? MODEL_MAIN;
  const started = Date.now();

  const response = await anthropic().messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    thinking: { type: "disabled" },
    tool_choice: { type: "tool", name: opts.toolName },
    tools: [
      {
        name: opts.toolName,
        description: opts.toolDescription,
        input_schema: opts.schema as Anthropic.Tool.InputSchema,
        strict: true,
      } as Anthropic.ToolUnion,
    ],
    messages: [{ role: "user", content: opts.userContent }],
  });

  const latency = Date.now() - started;
  const pricing = PRICING[model] ?? { input: 0, output: 0 };
  const cost =
    (response.usage.input_tokens * pricing.input + response.usage.output_tokens * pricing.output) / 1_000_000;

  await opts.supabase.from("ai_calls").insert({
    user_id: opts.userId,
    pipeline: opts.pipeline,
    model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    latency_ms: latency,
    cost_estimate_usd: cost,
    ref_id: opts.refId ?? null,
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === opts.toolName,
  );
  if (!toolUse) {
    throw new Error(`AI pipeline ${opts.pipeline}: no tool_use block (stop: ${response.stop_reason})`);
  }
  return toolUse.input as T;
}

/**
 * Plain-text call (used by the transcript cleanup pass and the coach where
 * markdown prose is the output). Also logged to ai_calls.
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

  const response = await anthropic().messages.create({
    model,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: opts.userContent }],
  });

  const latency = Date.now() - started;
  const pricing = PRICING[model] ?? { input: 0, output: 0 };
  const cost =
    (response.usage.input_tokens * pricing.input + response.usage.output_tokens * pricing.output) / 1_000_000;

  await opts.supabase.from("ai_calls").insert({
    user_id: opts.userId,
    pipeline: opts.pipeline,
    model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    latency_ms: latency,
    cost_estimate_usd: cost,
    ref_id: opts.refId ?? null,
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
