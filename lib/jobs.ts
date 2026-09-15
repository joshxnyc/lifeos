import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import { createServiceClient, singleUserId } from "@/lib/supabase/service";

export interface JobContext {
  supabase: SupabaseClient; // service role — RLS bypassed
  userId: string;
  now: Date;
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

/**
 * Wrapper for every /api/jobs/* route handler (SPEC §5): rejects without the
 * JOBS_SECRET header, logs a job_runs row, must be idempotent and finish
 * under 60s — batch and let the next tick continue if there's more work.
 * Sends a sync_failed push when the same job fails twice in a row (SPEC §11).
 */
export function jobRoute(jobName: string, handler: JobHandler) {
  return async function POST(req: NextRequest): Promise<NextResponse> {
    const secret = req.headers.get("x-jobs-secret") ?? req.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!secret || secret !== serverEnv().JOBS_SECRET) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const supabase = createServiceClient();
    const { data: run } = await supabase
      .from("job_runs")
      .insert({ job: jobName, status: "running" })
      .select("id")
      .single();

    try {
      const userId = await singleUserId(supabase);
      const stats = await handler({ supabase, userId, now: new Date() });
      if (run) {
        await supabase
          .from("job_runs")
          .update({ status: "ok", finished_at: new Date().toISOString(), stats })
          .eq("id", run.id);
      }
      return NextResponse.json({ ok: true, stats });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (run) {
        await supabase
          .from("job_runs")
          .update({ status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 2000) })
          .eq("id", run.id);
      }
      await maybeAlertRepeatedFailure(supabase, jobName);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  };
}

async function maybeAlertRepeatedFailure(supabase: SupabaseClient, jobName: string) {
  try {
    const { data: last } = await supabase
      .from("job_runs")
      .select("status")
      .eq("job", jobName)
      .order("started_at", { ascending: false })
      .limit(2);
    if (last?.length === 2 && last.every((r) => r.status === "failed")) {
      const userId = await singleUserId(supabase);
      const { enqueueNotification } = await import("@/lib/notify");
      await enqueueNotification(supabase, userId, {
        kind: "sync_failed",
        title: `${jobName} is failing`,
        body: `The ${jobName} job failed twice in a row. Check Settings → AI & Jobs.`,
        url: "/settings",
        scheduledFor: new Date(),
        payload: { job: jobName, routine_id: jobName }, // routine_id keys the daily dedupe index
        dedupeDaily: true,
      });
    }
  } catch {
    // alerting must never mask the original failure
  }
}
