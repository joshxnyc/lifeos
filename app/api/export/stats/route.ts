import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGE = 1000;

/**
 * GET /api/export/stats — the "storage used" line in Settings → Data
 * (SPEC §9). Sums the private `captures` audio bucket; Settings renders it.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let bytes = 0;
  let files = 0;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from("captures")
      .list("", { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const page = data ?? [];
    for (const file of page) {
      const size = (file.metadata as { size?: number } | null)?.size;
      if (typeof size === "number") bytes += size;
      files += 1;
    }
    if (page.length < PAGE) break;
  }

  const [{ count: captureCount }, { count: sourceCount }] = await Promise.all([
    supabase.from("captures").select("id", { count: "exact", head: true }),
    supabase.from("source_items").select("id", { count: "exact", head: true }),
  ]);

  return NextResponse.json({
    audio: { files, bytes, label: humanBytes(bytes) },
    captures: captureCount ?? 0,
    archived_items: sourceCount ?? 0,
  });
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
