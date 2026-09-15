import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { extForMime } from "@/lib/transcribe";
import { processCapture } from "@/lib/ai/pipelines/file-capture";
import type { CaptureSource } from "@/lib/types";

export const maxDuration = 60;

const SOURCES = ["phone_voice", "phone_text", "desktop_text", "desktop_voice"] as const;

const jsonSchema = z
  .object({
    source: z.enum(SOURCES),
    text: z.string().trim().min(1).max(20000).optional(),
    // Written by the browser client straight into the private `captures`
    // bucket, so the audio never passes through this route.
    audioPath: z
      .string()
      .regex(
        /^[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\.(m4a|webm|ogg|mp3|wav|flac)$/,
        "audioPath must be <user id>/<uuid>.<ext>",
      )
      .optional(),
  })
  .refine((v) => Boolean(v.text) !== Boolean(v.audioPath), {
    message: "Send either text or audioPath",
  });

/**
 * POST /api/capture — SPEC §7.1.
 *
 * Text captures are filed inline (one cheap call, fast enough to await, so the
 * result is on screen when the request returns). Voice captures return as soon
 * as the row exists and are processed by the job route; the every-minute
 * process-captures cron sweeps anything that kick misses.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let source: CaptureSource;
  let text: string | undefined;
  let audioPath: string | undefined;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const rawSource = String(form.get("source") ?? "");
    if (!(SOURCES as readonly string[]).includes(rawSource)) {
      return NextResponse.json({ error: "invalid source" }, { status: 400 });
    }
    source = rawSource as CaptureSource;
    const file = form.get("audio");
    const formText = form.get("text");

    if (file instanceof File) {
      const ext = extForMime(file.type);
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("captures")
        .upload(path, Buffer.from(await file.arrayBuffer()), {
          contentType: file.type || "audio/mp4",
          upsert: false,
        });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      audioPath = path;
    } else if (typeof formText === "string" && formText.trim()) {
      text = formText.trim().slice(0, 20000);
    } else {
      return NextResponse.json({ error: "Send either text or audio" }, { status: 400 });
    }
  } else {
    const parsed = jsonSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
    }
    ({ source, text, audioPath } = parsed.data);

    // The client uploads straight to storage, so the path it hands back is
    // only trusted once it is inside this user's own folder.
    if (audioPath && !audioPath.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: "audioPath is not yours" }, { status: 403 });
    }
  }

  const { data: capture, error } = await supabase
    .from("captures")
    .insert({
      user_id: user.id,
      source,
      raw_text: text ?? null,
      audio_path: audioPath ?? null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !capture) {
    return NextResponse.json({ error: error?.message ?? "could not save capture" }, { status: 500 });
  }
  const captureId = capture.id as string;

  if (text) {
    try {
      await processCapture(supabase, user.id, captureId);
    } catch {
      // The row is marked failed by processCapture; the screen offers Retry.
    }
  } else {
    kickProcessCaptures();
  }

  return NextResponse.json({ captureId });
}

/** Fire-and-forget nudge to the job route; the cron is the safety net. */
function kickProcessCaptures(): void {
  try {
    const env = serverEnv();
    void fetch(`${env.APP_URL}/api/jobs/process-captures`, {
      method: "POST",
      headers: { "x-jobs-secret": env.JOBS_SECRET, "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
    }).catch(() => {});
  } catch {
    // Missing env in a preview build must not fail the capture.
  }
}
