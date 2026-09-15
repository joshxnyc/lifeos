import { NextResponse } from "next/server";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { localDate } from "@/lib/time";
import type { Note } from "@/lib/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET /api/export — SPEC §9: one button, one zip, every table as JSON plus
 * notes as markdown. The antidote to lock-in, so it must never need the app
 * to read it back: plain files, no proprietary shape.
 *
 * Token columns are stripped: an export lands in Joshua's Downloads folder and
 * must not carry Google refresh tokens with it.
 */
const TABLES: { name: string; select?: string; order?: string; limit?: number }[] = [
  { name: "domains" },
  { name: "projects" },
  { name: "tasks" },
  { name: "routines" },
  { name: "routine_logs" },
  { name: "captures" },
  { name: "suggestions" },
  { name: "daily_plans" },
  { name: "notes" },
  { name: "people" },
  { name: "people_source_items" },
  {
    name: "connected_accounts",
    select:
      "id, user_id, created_at, updated_at, provider, label, external_identity, default_domain_id, token_expires_at, scopes, sync_state, writable_calendar_id, read_calendar_ids, status, last_synced_at, last_error",
  },
  { name: "source_items" },
  { name: "calendar_events" },
  { name: "push_subscriptions", select: "id, created_at, endpoint, device_label, last_used_at, failed_count" },
  { name: "notifications" },
  { name: "weekly_reviews" },
  { name: "settings" },
  { name: "job_runs", order: "started_at", limit: 500 },
  { name: "ai_calls", order: "created_at" },
];

const PAGE = 1000;
const MAX_ROWS = 50_000;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const settings = await getSettings(supabase, user.id);
  const today = localDate(new Date(), settings.timezone);

  const zip = new JSZip();
  const counts: Record<string, number> = {};

  for (const table of TABLES) {
    const rows = await fetchAll(supabase, table);
    counts[table.name] = rows.length;
    zip.file(`json/${table.name}.json`, JSON.stringify(rows, null, 2));
  }

  const { data: notes } = await supabase
    .from("notes")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(2000);
  const used = new Set<string>();
  for (const note of (notes ?? []) as Note[]) {
    const base = slugify(note.title) || "untitled";
    let slug = base;
    for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
    used.add(slug);
    const front = [
      "---",
      `title: ${JSON.stringify(note.title)}`,
      `created: ${note.created_at}`,
      `updated: ${note.updated_at}`,
      `pinned: ${note.pinned}`,
      "---",
      "",
    ].join("\n");
    zip.file(`notes/${slug}.md`, `${front}${note.body_md}\n`);
  }

  zip.file(
    "README.txt",
    [
      `LifeOS export — ${today}`,
      "",
      "json/  one file per table, exactly as stored.",
      "notes/ every note as markdown, front matter for the metadata.",
      "",
      "Access tokens are deliberately not included.",
      "",
      Object.entries(counts)
        .map(([name, count]) => `${name}: ${count}`)
        .join("\n"),
      "",
    ].join("\n"),
  );

  const body = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });

  return new NextResponse(body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="lifeos-export-${today}.zip"`,
      "cache-control": "no-store",
    },
  });
}

async function fetchAll(
  supabase: SupabaseClient,
  table: { name: string; select?: string; order?: string; limit?: number },
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const hardLimit = table.limit ?? MAX_ROWS;

  for (let from = 0; from < hardLimit; from += PAGE) {
    const to = Math.min(from + PAGE, hardLimit) - 1;
    let query = supabase.from(table.name).select(table.select ?? "*").range(from, to);
    query = table.order
      ? query.order(table.order, { ascending: false })
      : query.order("created_at", { ascending: true });
    const { data, error } = await query;
    if (error) throw new Error(`export ${table.name}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < to - from + 1) break;
  }
  return rows;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
