"use server";

// Today-screen writes: the manual top-item pick (SPEC §10 Phase 1 — the LLM
// proposal arrives in Phase 6) and a thin wrapper over A3's logRoutine so the
// routine pills can post without crossing workstream boundaries.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, currentUserId } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { localDate } from "@/lib/time";
import { logRoutine } from "@/lib/routines";
import type { ActionResult } from "@/components/tasks/types";

const uuid = z.string().uuid();

export async function setTopItem(taskId: string): Promise<ActionResult> {
  if (!uuid.safeParse(taskId).success) return { ok: false, error: "Unknown task." };

  const supabase = await createClient();
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Session expired. Sign in again." };

  const settings = await getSettings(supabase, userId);
  const date = localDate(new Date(), settings.timezone);

  const { error } = await supabase
    .from("daily_plans")
    .upsert(
      { user_id: userId, date, chosen_top_task_id: taskId },
      { onConflict: "user_id,date" },
    );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/today");
  return { ok: true, id: taskId };
}

export async function clearTopItem(): Promise<ActionResult> {
  const supabase = await createClient();
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Session expired. Sign in again." };

  const settings = await getSettings(supabase, userId);
  const date = localDate(new Date(), settings.timezone);

  const { error } = await supabase
    .from("daily_plans")
    .update({ chosen_top_task_id: null })
    .eq("user_id", userId)
    .eq("date", date);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/today");
  return { ok: true };
}

export async function logRoutineToday(
  routineId: string,
  date: string,
  status: "done" | "skipped",
): Promise<ActionResult> {
  const parsed = z
    .object({
      routineId: uuid,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      status: z.enum(["done", "skipped"]),
    })
    .safeParse({ routineId, date, status });
  if (!parsed.success) return { ok: false, error: "That routine log isn't valid." };

  try {
    await logRoutine(parsed.data.routineId, parsed.data.date, parsed.data.status);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not log that." };
  }

  revalidatePath("/today");
  revalidatePath("/routines");
  return { ok: true };
}
