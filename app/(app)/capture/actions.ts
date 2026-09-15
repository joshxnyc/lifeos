"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { processCapture } from "@/lib/ai/pipelines/file-capture";
import type { CaptureResult } from "@/lib/types";

const undoSchema = z.object({
  captureId: z.string().uuid(),
  itemId: z.string().uuid(),
  type: z.enum(["task", "reminder", "note", "routine_log", "person_update"]),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Per-card Undo on the capture result (DESIGN_BRIEF §5.2): removes the row the
 * filing created and drops the card from `captures.result`.
 */
export async function undoCaptureItem(input: z.infer<typeof undoSchema>): Promise<ActionResult> {
  const parsed = undoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { captureId, itemId, type } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: capture } = await supabase
    .from("captures")
    .select("id, result")
    .eq("id", captureId)
    .single();
  if (!capture) return { ok: false, error: "Capture not found." };

  const result = (capture.result ?? { items: [] }) as CaptureResult;
  const item = result.items.find((i) => i.id === itemId && i.type === type);

  if (type === "task" || type === "reminder") {
    await supabase.from("tasks").delete().eq("id", itemId).eq("origin_id", captureId);
  } else if (type === "note") {
    await supabase.from("notes").delete().eq("id", itemId);
  } else if (type === "routine_log") {
    await supabase.from("routine_logs").delete().eq("id", itemId);
  } else if (type === "person_update") {
    // The fact was appended as one dated line; take that line back out.
    const { data: person } = await supabase.from("people").select("notes_md").eq("id", itemId).single();
    const fact = item?.detail;
    if (person?.notes_md && fact) {
      const kept = String(person.notes_md)
        .split("\n")
        .filter((line) => !line.includes(fact))
        .join("\n")
        .trim();
      await supabase.from("people").update({ notes_md: kept || null }).eq("id", itemId);
    }
  }

  const next: CaptureResult = {
    ...result,
    items: result.items.filter((i) => !(i.id === itemId && i.type === type)),
  };
  await supabase.from("captures").update({ result: next }).eq("id", captureId);

  revalidatePath("/capture");
  return { ok: true };
}

/** Retry a failed capture. The audio was kept, so nothing is lost (SPEC §7.1). */
export async function retryCapture(captureId: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(captureId).success) return { ok: false, error: "Invalid capture." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  await supabase
    .from("captures")
    .update({ status: "pending", error: null, cleaned_text: null })
    .eq("id", captureId);

  try {
    await processCapture(supabase, user.id, captureId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Filing failed again." };
  }

  revalidatePath("/capture");
  return { ok: true };
}
