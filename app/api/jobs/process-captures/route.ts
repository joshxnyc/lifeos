import type { SupabaseClient } from "@supabase/supabase-js";
import { jobRoute } from "@/lib/jobs";
import { enqueueNotification } from "@/lib/notify";
import { processCapture } from "@/lib/ai/pipelines/file-capture";

export const maxDuration = 60;

/** Captures stuck mid-pipeline for longer than this are picked up again. */
const STUCK_MS = 30_000;
const PER_RUN = 5;

/**
 * process-captures (every minute, plus a kick from POST /api/capture).
 *
 * Picks up voice captures as soon as they are written, and anything that
 * stalled in transcribing/filing — a cold start or a timeout mid-pipeline.
 * Each row is claimed with a conditional status update so two overlapping runs
 * never file the same capture twice.
 */
export const POST = jobRoute("process-captures", async ({ supabase, userId, now }) => {
  const { data, error } = await supabase
    .from("captures")
    .select("id, status, audio_path, updated_at")
    .eq("user_id", userId)
    .in("status", ["pending", "transcribing", "filing"])
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(`capture sweep: ${error.message}`);

  const rows = (data ?? []) as {
    id: string;
    status: "pending" | "transcribing" | "filing";
    audio_path: string | null;
    updated_at: string;
  }[];

  const candidates = rows
    .filter((row) => {
      const stale = now.getTime() - new Date(row.updated_at).getTime() > STUCK_MS;
      // Voice captures are never filed inline by the API route, so they are
      // eligible immediately; everything else waits until it looks stuck.
      return (row.status === "pending" && row.audio_path) || stale;
    })
    .slice(0, PER_RUN);

  let processed = 0;
  let failed = 0;
  let notified = 0;

  for (const row of candidates) {
    const claimStatus = row.audio_path ? "transcribing" : "filing";
    const { data: claimed } = await supabase
      .from("captures")
      .update({ status: claimStatus })
      .eq("id", row.id)
      .eq("status", row.status)
      .select("id");
    if (!claimed?.length) continue; // another run got there first

    try {
      await processCapture(supabase, userId, row.id);
      processed += 1;
    } catch {
      failed += 1; // processCapture has already written status/error on the row
    }

    // The sweep only claims pending/transcribing/filing rows, so a row that
    // reads `failed` now transitioned on THIS run — rows that failed on a
    // previous run are never candidates again. Read the row back rather than
    // trusting the throw: an empty capture lands `failed` without throwing.
    if (await notifyIfJustFailed(supabase, userId, row.id)) notified += 1;
  }

  return { scanned: rows.length, eligible: candidates.length, processed, failed, notified };
});

/** Push "A capture didn't file" for a row that just landed in failed. */
async function notifyIfJustFailed(
  supabase: SupabaseClient,
  userId: string,
  captureId: string,
): Promise<boolean> {
  try {
    const { data: after } = await supabase
      .from("captures")
      .select("status, error")
      .eq("id", captureId)
      .single();
    if (after?.status !== "failed") return false;
    // dedupeDaily keys on payload.routine_id, so a retry of the same capture
    // that fails again today stays quiet instead of spamming.
    return await enqueueNotification(supabase, userId, {
      kind: "custom",
      title: "A capture didn't file",
      body: ((after.error as string | null) ?? "Filing failed.").split("\n")[0]!.slice(0, 200),
      url: "/capture",
      scheduledFor: new Date(),
      payload: { routine_id: `capture_failed:${captureId}` },
      dedupeDaily: true,
    });
  } catch {
    return false; // alerting must never fail the sweep itself
  }
}
