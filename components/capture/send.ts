"use client";

// Client-side senders shared by the capture screen, the global record sheet
// and smart add: upload audio to the caller's own storage folder, then create
// the capture row through POST /api/capture.

import type { createClient } from "@/lib/supabase/client";

const EXT: Record<string, string> = { mp4: "m4a", webm: "webm", ogg: "ogg", mpeg: "mp3", wav: "wav" };

export const isPhone = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;

/** Upload straight to storage; the policy only allows the user's own folder. */
export async function uploadAudio(
  supabase: ReturnType<typeof createClient>,
  blob: Blob,
): Promise<string> {
  const subtype = (blob.type.split("/")[1] ?? "mp4").split(";")[0]!;
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Session expired. Sign in again.");
  const path = `${userId}/${crypto.randomUUID()}.${EXT[subtype] ?? "m4a"}`;
  const { error } = await supabase.storage
    .from("captures")
    .upload(path, blob, { contentType: blob.type || "audio/mp4", upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function postCapture(body: Record<string, unknown>): Promise<string> {
  const res = await fetch("/api/capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { captureId?: string; error?: string };
  if (!res.ok || !json.captureId) throw new Error(json.error ?? "Capture failed to save.");
  return json.captureId;
}
