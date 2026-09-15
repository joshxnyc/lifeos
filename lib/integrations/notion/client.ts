import "server-only";
import { Client } from "@notionhq/client";
import { serverEnv } from "@/lib/env";

/**
 * Notion, READ-ONLY, FOREVER (SPEC §6.2, CLAUDE.md §4 hard rule: never write
 * to Notion — Joshua's standing rule is that nothing may revert a layout or a
 * view he changed by hand).
 *
 * Everything the app needs from Notion goes through the four functions below.
 * There is deliberately no pages.create / pages.update / blocks.append
 * anywhere in this codebase. If a future session needs to write, that is a
 * product decision for Joshua, not a code change to slip in here.
 */

export function notionConfigured(): boolean {
  return Boolean(serverEnv().NOTION_TOKEN);
}

function client(): Client {
  const token = serverEnv().NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN is not set");
  return new Client({ auth: token });
}

export interface NotionSearchResult {
  id: string;
  object: "page" | "database";
  title: string;
  url: string;
  last_edited_time: string;
  parent_database_id: string | null;
  archived: boolean;
  properties: Record<string, unknown>;
}

interface RawResult {
  id: string;
  object: string;
  url?: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  title?: unknown;
  properties?: Record<string, unknown>;
  parent?: { type?: string; database_id?: string };
}

/** The workspace this integration token belongs to (shown in Settings). */
export async function getWorkspaceName(): Promise<string> {
  const me = (await client().users.me({})) as unknown as {
    bot?: { workspace_name?: string | null };
    name?: string | null;
  };
  return me.bot?.workspace_name ?? me.name ?? "Notion workspace";
}

/**
 * Everything the integration has been shared with, newest edit first.
 * `since` stops the walk once results are older than the cursor.
 */
export async function searchShared(opts: {
  objectType?: "page" | "database";
  since?: string | null;
  limit?: number;
}): Promise<NotionSearchResult[]> {
  const notion = client();
  const out: NotionSearchResult[] = [];
  let cursor: string | undefined;
  const limit = opts.limit ?? 100;

  do {
    const res = (await notion.search({
      ...(opts.objectType ? { filter: { property: "object", value: opts.objectType } } : {}),
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: 50,
      start_cursor: cursor,
    })) as unknown as { results: RawResult[]; next_cursor: string | null; has_more: boolean };

    for (const raw of res.results) {
      const mapped = mapResult(raw);
      if (opts.since && mapped.last_edited_time <= opts.since) return out;
      out.push(mapped);
      if (out.length >= limit) return out;
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return out;
}

/** Rows of one database edited since the cursor. */
export async function queryDatabase(
  databaseId: string,
  since: string | null,
  limit = 100,
): Promise<NotionSearchResult[]> {
  const notion = client();
  const out: NotionSearchResult[] = [];
  let cursor: string | undefined;

  do {
    const res = (await notion.databases.query({
      database_id: databaseId,
      ...(since
        ? { filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: since } } }
        : {}),
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      page_size: 50,
      start_cursor: cursor,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as unknown as { results: RawResult[]; next_cursor: string | null; has_more: boolean };

    for (const raw of res.results) {
      out.push(mapResult(raw));
      if (out.length >= limit) return out;
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return out;
}

export interface NotionBlock {
  id: string;
  type: string;
  text: string;
  has_children: boolean;
}

/** Plain text of a page's blocks. Depth ≤ 2 (SPEC §6.2). */
export async function pageBlocksText(pageId: string, depth = 2): Promise<string> {
  const lines: string[] = [];
  await walk(pageId, depth, lines);
  return lines.join("\n").trim();
}

async function walk(blockId: string, depth: number, out: string[]): Promise<void> {
  if (depth <= 0 || out.length > 400) return;
  const notion = client();
  let cursor: string | undefined;
  do {
    const res = (await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    })) as unknown as {
      results: Array<Record<string, unknown>>;
      next_cursor: string | null;
      has_more: boolean;
    };
    for (const block of res.results) {
      const type = String(block.type ?? "");
      const body = block[type] as { rich_text?: unknown; checked?: boolean } | undefined;
      const text = richText(body?.rich_text);
      if (text) {
        if (type === "to_do") out.push(`${body?.checked ? "[x]" : "[ ]"} ${text}`);
        else if (type.startsWith("heading")) out.push(`\n${text}`);
        else if (type.endsWith("list_item")) out.push(`- ${text}`);
        else out.push(text);
      }
      if (block.has_children && depth > 1) await walk(String(block.id), depth - 1, out);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor && out.length <= 400);
}

// ---------------------------------------------------------------------------
// property / rich-text flattening
// ---------------------------------------------------------------------------

function mapResult(raw: RawResult): NotionSearchResult {
  const properties = (raw.properties ?? {}) as Record<string, unknown>;
  return {
    id: raw.id,
    object: raw.object === "database" ? "database" : "page",
    title: raw.object === "database" ? richText(raw.title) || "Untitled database" : pageTitle(properties),
    url: raw.url ?? `https://www.notion.so/${raw.id.replace(/-/g, "")}`,
    last_edited_time: raw.last_edited_time ?? new Date(0).toISOString(),
    parent_database_id: raw.parent?.type === "database_id" ? (raw.parent.database_id ?? null) : null,
    archived: Boolean(raw.archived || raw.in_trash),
    properties,
  };
}

export function pageTitle(properties: Record<string, unknown>): string {
  for (const value of Object.values(properties)) {
    const prop = value as { type?: string; title?: unknown };
    if (prop?.type === "title") {
      const text = richText(prop.title);
      if (text) return text;
    }
  }
  return "Untitled";
}

export function richText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      const p = part as { plain_text?: string };
      return p?.plain_text ?? "";
    })
    .join("")
    .trim();
}

/** One property flattened to a readable string ("" when empty). */
export function propertyToText(value: unknown): string {
  const prop = value as Record<string, unknown> & { type?: string };
  if (!prop?.type) return "";
  switch (prop.type) {
    case "title":
      return richText(prop.title);
    case "rich_text":
      return richText(prop.rich_text);
    case "select":
      return (prop.select as { name?: string } | null)?.name ?? "";
    case "status":
      return (prop.status as { name?: string } | null)?.name ?? "";
    case "multi_select":
      return ((prop.multi_select as Array<{ name?: string }>) ?? []).map((s) => s.name).join(", ");
    case "date": {
      const d = prop.date as { start?: string; end?: string } | null;
      return d?.start ? [d.start, d.end].filter(Boolean).join(" → ") : "";
    }
    case "people":
      return ((prop.people as Array<{ name?: string }>) ?? []).map((p) => p.name).filter(Boolean).join(", ");
    case "checkbox":
      return prop.checkbox ? "yes" : "no";
    case "number":
      return prop.number === null || prop.number === undefined ? "" : String(prop.number);
    case "url":
    case "email":
    case "phone_number":
      return (prop[prop.type] as string | null) ?? "";
    case "formula": {
      const f = prop.formula as { string?: string; number?: number; boolean?: boolean; date?: { start?: string } } | null;
      return f?.string ?? (f?.number !== undefined ? String(f.number) : "") ?? "";
    }
    case "created_time":
    case "last_edited_time":
      return (prop[prop.type] as string | null) ?? "";
    default:
      return "";
  }
}

/** The ISO date inside a date-ish property, for mirror task due dates. */
export function propertyToDate(value: unknown): string | null {
  const prop = value as Record<string, unknown> & { type?: string };
  if (!prop?.type) return null;
  if (prop.type === "date") return (prop.date as { start?: string } | null)?.start ?? null;
  if (prop.type === "created_time" || prop.type === "last_edited_time") {
    const raw = prop[prop.type] as string | null;
    return raw ? raw.slice(0, 10) : null;
  }
  if (prop.type === "formula") {
    const f = prop.formula as { date?: { start?: string } | null } | null;
    return f?.date?.start ?? null;
  }
  return null;
}
