import { jobRoute } from "@/lib/jobs";
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
  }

  return { scanned: rows.length, eligible: candidates.length, processed, failed };
});
