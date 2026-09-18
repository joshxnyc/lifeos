"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { answerQuestion, type AnswerSource } from "@/lib/ai/pipelines/answer";

// The Ask screen's one action. RLS client, so retrieval only ever sees the
// signed-in user's rows. Not behind the daily AI budget: it is interactive
// and user-initiated (see lib/ai/client.ts BUDGETED_PIPELINES).

const askSchema = z.object({
  question: z.string().trim().min(1).max(500),
  priorTurn: z
    .object({
      question: z.string().max(500),
      answer: z.string().max(4000),
    })
    .optional(),
});

export type AskInput = z.infer<typeof askSchema>;
export type AskResult =
  | { ok: true; answer: string; sources: AnswerSource[] }
  | { ok: false; error: string };

export async function askQuestion(input: AskInput): Promise<AskResult> {
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Ask in 500 characters or fewer." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  try {
    const result = await answerQuestion(
      supabase,
      user.id,
      parsed.data.question,
      parsed.data.priorTurn,
    );
    return { ok: true, ...result };
  } catch {
    return { ok: false, error: "The answer failed to generate. Ask again." };
  }
}
