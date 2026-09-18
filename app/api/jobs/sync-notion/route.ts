import { jobRoute } from "@/lib/jobs";
import { notionConfigured } from "@/lib/integrations/notion/client";
import { syncNotion } from "@/lib/integrations/notion/sync";

/**
 * Every 30 minutes: mirror the Tarifa Notion, read-only (SPEC §5, §6.2).
 * No-ops quietly when NOTION_TOKEN is not set, so the schedule can exist from
 * Phase 0 and only starts doing work when Joshua adds the token.
 */
export const maxDuration = 60;

export const POST = jobRoute("sync-notion", async ({ supabase, userId }) => {
  if (!notionConfigured()) return { skipped: "NOTION_TOKEN not set" };
  const started = Date.now();
  const stats = await syncNotion({ supabase, userId, deadline: started + 45_000 });
  return { ...stats, ms: Date.now() - started };
});
