import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getWorkspaceName,
  pageBlocksText,
  pageTitle,
  propertyToDate,
  propertyToText,
  queryDatabase,
  searchShared,
  notionConfigured,
  type NotionSearchResult,
} from "@/lib/integrations/notion/client";
import { getNotionConfig, type NotionDatabaseConfig } from "@/lib/integrations/notion/config";
import { mergeSyncState, markSynced, setAccountError } from "@/lib/integrations/accounts";
import { upsertSourceItem } from "@/lib/integrations/source-items";
import { ascendingPrefixCursor } from "@/lib/domain/sync-cursor";
import type { ConnectedAccount } from "@/lib/types";

/**
 * Tarifa's Notion, mirrored read-only (SPEC §6.2). Pages become source_items;
 * rows of a database Joshua marked "task-like" also become tasks with
 * is_mirror = true, which every UI renders read-only with a link out.
 *
 * Nothing in this path writes to Notion.
 */

/** Pages fully ingested per run (block fetch + upsert + mirror task). */
const PAGE_BUDGET = 40;
/**
 * Page HEADERS fetched per stream per run (search results / database rows,
 * 50 per API call). Kept far above any realistic between-run backlog: the
 * cursor can only advance on a truncated run when the header fetch saw
 * everything newer than the cursor (see the cursor rule in syncNotion).
 */
const FETCH_BUDGET = 500;
/** See the comment at the nextCursor computation in syncNotion. */
const CURSOR_SAFETY_MS = 60_000;

export interface NotionStats {
  pages_seen: number;
  items_written: number;
  items_changed: number;
  mirror_tasks_upserted: number;
  databases_queried: number;
  cursor: string | null;
}

/**
 * The single Notion "account" row. There are no OAuth tokens (SPEC §6.2 uses
 * an internal integration token) — the row exists so the archive, the sync
 * cursor and the default domain have somewhere to live, like every other
 * provider.
 */
export async function ensureNotionAccount(
  supabase: SupabaseClient,
  userId: string,
  workspaceName?: string,
): Promise<ConnectedAccount | null> {
  if (!notionConfigured()) return null;

  const { data: existing } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "notion")
    .maybeSingle();
  if (existing) return existing as ConnectedAccount;

  const identity = workspaceName ?? (await getWorkspaceName());
  const { data: tarifa } = await supabase
    .from("domains")
    .select("id")
    .eq("user_id", userId)
    .eq("slug", "tarifa")
    .maybeSingle();

  const { data, error } = await supabase
    .from("connected_accounts")
    .insert({
      user_id: userId,
      provider: "notion",
      label: identity,
      external_identity: identity,
      default_domain_id: (tarifa?.id as string | undefined) ?? null,
      status: "active",
    })
    .select("*")
    .single();
  if (error) throw new Error(`ensureNotionAccount: ${error.message}`);
  return data as ConnectedAccount;
}

export async function syncNotion(opts: {
  supabase: SupabaseClient;
  userId: string;
  deadline: number;
}): Promise<NotionStats> {
  const { supabase, userId, deadline } = opts;
  const stats: NotionStats = {
    pages_seen: 0,
    items_written: 0,
    items_changed: 0,
    mirror_tasks_upserted: 0,
    databases_queried: 0,
    cursor: null,
  };

  const account = await ensureNotionAccount(supabase, userId);
  if (!account) return stats;

  const config = await getNotionConfig(supabase, userId);
  const state = (account.sync_state ?? {}) as { last_edited_cursor?: string | null };
  const cursor = state.last_edited_cursor ?? null;

  const ingest = async (page: NotionSearchResult, dbConfig?: NotionDatabaseConfig) => {
    stats.pages_seen += 1;

    const propertyLines = Object.entries(page.properties)
      .map(([name, value]) => {
        const text = propertyToText(value);
        return text ? `${name}: ${text}` : "";
      })
      .filter(Boolean);

    let blocks = "";
    try {
      blocks = await pageBlocksText(page.id, 2);
    } catch {
      blocks = ""; // a page whose blocks we cannot read is still worth archiving
    }

    const text = [page.title, propertyLines.join("\n"), blocks].filter(Boolean).join("\n\n");

    const item = await upsertSourceItem(supabase, userId, {
      accountId: account.id,
      provider: "notion",
      kind: "notion_page",
      externalId: `notion:${page.id}`,
      externalUrl: page.url,
      title: page.title,
      text,
      raw: { id: page.id, last_edited_time: page.last_edited_time, archived: page.archived },
      participants: [],
      occurredAt: page.last_edited_time,
      defaultDomainId: account.default_domain_id,
    });
    stats.items_written += 1;
    if (item.changed) stats.items_changed += 1;

    if (dbConfig?.taskLike) {
      const upserted = await upsertMirrorTask(supabase, userId, account, page, dbConfig, item.id);
      if (upserted) stats.mirror_tasks_upserted += 1;
    }
  };

  // Cursor rule (see lib/domain/sync-cursor.ts): fetch page HEADERS
  // exhaustively for everything edited since the cursor (headers are cheap —
  // the expensive part is the per-page block fetch), sort them ascending and
  // ingest OLDEST-FIRST up to the page budget. A truncated run then advances
  // the cursor to just before the oldest page it did NOT ingest: everything
  // older was ingested this run, everything newer is refetched next run. That
  // drains an oversized backlog a slice per run without ever skipping a page.
  // If the header fetch itself was cut short (header cap, deadline, or a
  // database that failed to answer), the unfetched pages' edit times are
  // unknown and the cursor stays put — Notion's streams are newest-first, so
  // their unfetched remainder can be arbitrarily close to the old cursor.

  // 1. Fetch phase. The shared search plus each configured database, so
  //    task-like rows are never missed even if search paging cut them off.
  //    Merged by page id — a database row usually also appears in search.
  const byId = new Map<string, NotionSearchResult>();
  let fetchExhausted = true;
  let hadError = false;

  const pages = await searchShared({ objectType: "page", since: cursor, limit: FETCH_BUDGET });
  if (pages.length >= FETCH_BUDGET) fetchExhausted = false; // search itself may have more
  for (const page of pages) byId.set(page.id, page);

  for (const db of config.databases) {
    if (Date.now() > deadline) {
      fetchExhausted = false; // its rows were never seen; the cursor must not pass them
      break;
    }
    stats.databases_queried += 1;
    try {
      const rows = await queryDatabase(db.id, cursor, FETCH_BUDGET);
      if (rows.length >= FETCH_BUDGET) fetchExhausted = false;
      for (const row of rows) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    } catch (err) {
      // A database we could not read may hold edits newer than the cursor
      // that this run never saw; treating the fetch as non-exhaustive pins
      // the cursor so nothing of it is skipped once it recovers.
      fetchExhausted = false;
      hadError = true;
      await setAccountError(
        supabase,
        account.id,
        `Database ${db.name || db.id}: ${err instanceof Error ? err.message : "query failed"}`,
      );
    }
  }

  // 2. Ingest phase, oldest edit first (see the cursor rule above).
  const ordered = [...byId.values()].sort((a, b) =>
    a.last_edited_time < b.last_edited_time ? -1 : a.last_edited_time > b.last_edited_time ? 1 : 0,
  );
  let processed = 0;
  // Once the budget is reached, keep going through pages within the safety
  // margin of the budget boundary before stopping. Stopping mid-cohort would
  // otherwise stall a bulk edit: with more than PAGE_BUDGET pages sharing one
  // last_edited_time (minute granularity), the truncation boundary minus the
  // margin is not > the stored cursor, ascendingPrefixCursor returns null
  // every run, and the same PAGE_BUDGET pages get re-ingested forever while
  // the rest of the cohort is never reached. Processing through the margin
  // makes the first unprocessed page's timestamp exceed the last processed
  // one by more than the margin, so the truncated run always advances. The
  // deadline still bounds the overshoot.
  let stopAfter: number | null = null;
  for (const page of ordered) {
    if (Date.now() > deadline) break;
    if (processed >= PAGE_BUDGET) {
      stopAfter ??= Date.parse(ordered[PAGE_BUDGET - 1]!.last_edited_time) + CURSOR_SAFETY_MS;
      if (Date.parse(page.last_edited_time) > stopAfter) break;
    }
    const dbConfig = page.parent_database_id
      ? config.databases.find((d) => normalizeId(d.id) === normalizeId(page.parent_database_id ?? ""))
      : undefined;
    await ingest(page, dbConfig);
    processed += 1;
  }

  // The one-minute safety margin keeps a not-yet-ingested page whose
  // last_edited_time equals the boundary (Notion timestamps have minute
  // granularity) fetchable by the next run's strictly-newer-than-cursor
  // search. Re-ingesting the pages just before the boundary is free
  // (content-hash upserts).
  const nextCursor = ascendingPrefixCursor(
    cursor,
    ordered.map((p) => p.last_edited_time),
    processed,
    fetchExhausted,
    CURSOR_SAFETY_MS,
  );
  if (nextCursor) {
    await mergeSyncState(supabase, account.id, { last_edited_cursor: nextCursor });
  }
  // A per-database error was already written to last_error above; a plain
  // markSynced would wipe it at the end of the very run that recorded it.
  await markSynced(supabase, account.id, { keepError: hadError });
  stats.cursor = nextCursor ?? cursor;
  return stats;
}

/**
 * A task-like row becomes a mirror task: origin notion_mirror, origin_id the
 * page id (a unique partial index keeps it to one), is_mirror true. Never
 * editable in the app; completing it happens in Notion and comes back here.
 */
async function upsertMirrorTask(
  supabase: SupabaseClient,
  userId: string,
  account: ConnectedAccount,
  page: NotionSearchResult,
  db: NotionDatabaseConfig,
  sourceItemId: string,
): Promise<boolean> {
  const domainId = account.default_domain_id ?? (await tarifaDomainId(supabase, userId));
  if (!domainId) return false;

  const title =
    (db.map.title ? propertyToText(page.properties[db.map.title]) : "") || pageTitle(page.properties) || page.title;

  const dueRaw = db.map.due ? propertyToDate(page.properties[db.map.due]) : null;
  const dueDate = dueRaw ? dueRaw.slice(0, 10) : null;

  const statusValue = db.map.status ? propertyToText(page.properties[db.map.status]) : "";
  const done =
    page.archived ||
    (Boolean(statusValue) &&
      db.map.doneValues.some((v) => v.toLowerCase() === statusValue.toLowerCase()));

  const { data: existing } = await supabase
    .from("tasks")
    .select("id, status")
    .eq("origin", "notion_mirror")
    .eq("origin_id", page.id)
    .maybeSingle();

  const row = {
    domain_id: domainId,
    title: title.slice(0, 500),
    status: done ? "done" : "open",
    due_date: dueDate,
    is_mirror: true,
    origin: "notion_mirror",
    origin_id: page.id,
    // The archive row carries external_url; every task list renders the mirror
    // link out through the source_items join, so it has to be set here.
    source_item_id: sourceItemId,
    completed_at: done ? (existing?.status === "done" ? undefined : new Date().toISOString()) : null,
  };

  if (existing) {
    const patch = { ...row };
    if (patch.completed_at === undefined) delete (patch as { completed_at?: string | null }).completed_at;
    const { error } = await supabase.from("tasks").update(patch).eq("id", existing.id);
    if (error) throw new Error(`mirror task update: ${error.message}`);
  } else {
    const { error } = await supabase.from("tasks").insert({
      user_id: userId,
      ...row,
      completed_at: done ? new Date().toISOString() : null,
    });
    if (error) throw new Error(`mirror task insert: ${error.message}`);
  }
  return true;
}

async function tarifaDomainId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("domains")
    .select("id")
    .eq("user_id", userId)
    .eq("slug", "tarifa")
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

function normalizeId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}
