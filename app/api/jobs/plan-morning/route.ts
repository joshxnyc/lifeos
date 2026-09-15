import { jobRoute } from "@/lib/jobs";
import { planMorning } from "@/lib/ai/pipelines/top-item";

// SPEC §5: runs every 15 minutes and no-ops unless the local time is the
// planning window (or the day still has no plan and it is before noon).
export const POST = jobRoute("plan-morning", async ({ supabase, userId, now }) =>
  planMorning(supabase, userId, now),
);

export const maxDuration = 60;
