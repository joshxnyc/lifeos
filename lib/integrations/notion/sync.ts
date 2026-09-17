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
import type { ConnectedAccount } from "@/lib/types";

/**
 * Tarifa's Notion, mirrored read-only (SPEC §6.2). Pages become source_items;
 * rows of a database Joshua marked "task-like" also become tasks with
 * is_mirror = true, which every UI renders read-only with a link out.
 *
 * Nothing in this path writes to Notion.
 */

const PAGE_BUDGET = 40;

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
  let newest = cursor;

  const seen = new Set<string>();
  const ingest = async (page: NotionSearchResult, dbConfig?: NotionDatabaseConfig) => {
    if (seen.has(page.id) || stats.pages_seen >= PAGE_BUDGET) return;
    seen.add(page.id);
    stats.pages_seen += 1;
    if (!newest || page.last_edited_time > newest) newest = page.last_edited_time;

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

  // The cursor may only advance when this run saw everything: a run cut short
  // by the page budget or the deadline has pages older than `newest` still
  // unfetched, and advancing past them would skip them forever. On a
  // truncated run the cursor stays put — re-fetches are free (content-hash
  // upserts) and the next run continues from the same spot.
  let truncated = false;
  const outOfRoom = () => {
    if (Date.now() > deadline || stats.pages_seen >= PAGE_BUDGET) {
      truncated = true;
      return true;
    }
    return false;
  };

  // 1. Everything shared with the integration, newest edit first, stopping at
  //    the cursor (SPEC §6.2: search filtered by last_edited_time > cursor).
  const pages = await searchShared({ objectType: "page", since: cursor, limit: PAGE_BUDGET });
  if (pages.length >= PAGE_BUDGET) truncated = true; // search itself may have more
  for (const page of pages) {
    if (outOfRoom()) break;
    const dbConfig = page.parent_database_id
      ? config.databases.find((d) => normalizeId(d.id) === normalizeId(page.parent_database_id ?? ""))
      : undefined;
    await ingest(page, dbConfig);
  }

  // 2. Each configured database, so task-like rows are never missed even if
  //    search paging cut them off.
  for (const db of config.databases) {
    if (outOfRoom()) break;
    stats.databases_queried += 1;
    try {
      const rows = await queryDatabase(db.id, cursor, PAGE_BUDGET);
      if (rows.length >= PAGE_BUDGET) truncated = true;
      for (const row of rows) {
        if (outOfRoom()) break;
        await ingest(row, db);
      }
    } catch (err) {
      await setAccountError(
        supabase,
        account.id,
        `Database ${db.name || db.id}: ${err instanceof Error ? err.message : "query failed"}`,
      );
    }
  }

  if (!truncated && newest && newest !== cursor) {
    await mergeSyncState(supabase, account.id, { last_edited_cursor: newest });
  }
  await markSynced(supabase, account.id);
  stats.cursor = newest;
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
