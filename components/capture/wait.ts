"use client";

// Poll a capture row until the pipeline lands it. Shared by smart add (typed,
// usually one loop) and the global record sheet (audio, allowed much longer
// because transcription is a real wait).

import type { createClient } from "@/lib/supabase/client";
import type { CaptureResult } from "@/lib/types";

export interface CaptureRow {
  status: string;
  result: CaptureResult | null;
  error: string | null;
}

export async function waitForCaptureRow(
  supabase: ReturnType<typeof createClient>,
  captureId: string,
  { pollMs, maxWaitMs }: { pollMs: number; maxWaitMs: number },
): Promise<CaptureRow | null> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const { data } = await supabase
      .from("captures")
      .select("status, result, error")
      .eq("id", captureId)
      .single();
    const row = data as CaptureRow | null;
    if (row && (row.status === "done" || row.status === "failed")) return row;
    if (Date.now() + pollMs > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
