import { jobRoute } from "@/lib/jobs";
import { runExtractionSweep } from "@/lib/ai/pipelines/extract";

// SPEC §5: hourly extraction sweep. Batched (40 items) and time-boxed (45s);
// whatever is left stays pending for the next tick.
export const POST = jobRoute("extract", async ({ supabase, userId, now }) =>
  runExtractionSweep(supabase, userId, { now }),
);

export const maxDuration = 60;
