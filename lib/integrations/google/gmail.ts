import "server-only";
import { google, type Auth, type gmail_v1 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanEmailText, isNewsletterish } from "@/lib/email/clean";
import { mergeSyncState } from "@/lib/integrations/accounts";
import { upsertSourceItem, type SourceParticipant } from "@/lib/integrations/source-items";
import { errorStatus } from "@/lib/integrations/google/client";
import type { ConnectedAccount } from "@/lib/types";

/**
 * Gmail → source_items, one item per thread (SPEC §6.1).
 * Read-only: the only Gmail scope this app ever requests is gmail.readonly
 * (CLAUDE.md §4), so nothing here labels, archives, sends or trashes.
 *
 * Budget: the whole sync-google job must finish well inside Vercel's 60s, so
 * this processes a bounded batch and stores its cursor every run.
 */

const THREADS_PER_RUN = 25;
/**
 * Hard ceiling on the initial backfill window. The rolling window is 7 days;
 * the `extraction_lookback_days_initial` setting is clamped to this so a live
 * settings row that still carries the old default of 30 (seeded by the init
 * migration) takes effect as 7 without a manual update to the database.
 */
export const GMAIL_BACKFILL_MAX_DAYS = 7;
const NO_REPLY = /(^|[.\-_+])(no[-._]?reply|do[-._]?not[-._]?reply|notifications?|mailer|postmaster|bounce)@/i;

export interface GmailSyncState {
  history_id?: string | null;
  backfill_done?: boolean;
  backfill_page_token?: string | null;
}

export interface GmailStats {
  mode: "backfill" | "incremental" | "reseed";
  threads_seen: number;
  items_written: number;
  items_changed: number;
  skipped_newsletters: number;
  backfill_done: boolean;
}

export async function syncGmailForAccount(opts: {
  supabase: SupabaseClient;
  userId: string;
  account: ConnectedAccount;
  auth: Auth.OAuth2Client;
  lookbackDays: number;
  deadline: number;
}): Promise<GmailStats> {
  const { supabase, userId, account, auth, lookbackDays, deadline } = opts;
  const gmail = google.gmail({ version: "v1", auth });
  const state = (account.sync_state ?? {}) as GmailSyncState;

  const stats: GmailStats = {
    mode: state.backfill_done ? "incremental" : "backfill",
    threads_seen: 0,
    items_written: 0,
    items_changed: 0,
    skipped_newsletters: 0,
    backfill_done: Boolean(state.backfill_done),
  };

  // Seed the history cursor *before* the backfill so messages that arrive
  // during it are replayed by the next incremental run.
  let historyId = state.history_id ?? null;
  if (!historyId) {
    const profile = await gmail.users.getProfile({ userId: "me" });
    historyId = profile.data.historyId ?? null;
    await mergeSyncState(supabase, account.id, { history_id: historyId });
  }

  const ingest = async (threadId: string) => {
    stats.threads_seen += 1;
    const outcome = await ingestThread({ supabase, userId, account, gmail, threadId });
    if (outcome === "skipped") stats.skipped_newsletters += 1;
    else {
      stats.items_written += 1;
      if (outcome === "changed") stats.items_changed += 1;
    }
  };

  if (!state.backfill_done) {
    const q = [
      `newer_than:${Math.min(GMAIL_BACKFILL_MAX_DAYS, Math.max(1, lookbackDays))}d`,
      "-in:spam",
      "-in:trash",
      "-category:promotions",
      "-category:social",
    ].join(" ");

    const res = await gmail.users.threads.list({
      userId: "me",
      q,
      maxResults: THREADS_PER_RUN,
      pageToken: state.backfill_page_token ?? undefined,
    });

    let finishedPage = true;
    for (const t of res.data.threads ?? []) {
      if (Date.now() > deadline) {
        finishedPage = false;
        break;
      }
      if (t.id) await ingest(t.id);
    }

    if (finishedPage) {
      const next = res.data.nextPageToken ?? null;
      stats.backfill_done = !next;
      await mergeSyncState(supabase, account.id, {
        backfill_page_token: next,
        backfill_done: !next,
      });
    }
    return stats;
  }

  // Incremental: history.list from the stored historyId.
  const threadIds = new Set<string>();
  let pageToken: string | undefined;
  let newHistoryId = historyId;
  // The record ids we actually walked. res.data.historyId is the MAILBOX'S
  // CURRENT history id, not a page watermark — adopting it after a page walk
  // cut short (thread cap / deadline) would skip every unfetched record. On a
  // partial walk the cursor advances only to the newest record id seen, so the
  // next run resumes exactly after it.
  let maxRecordId: bigint | null = null;
  let walkedAllPages = false;
  try {
    do {
      const res = await gmail.users.history.list({
        userId: "me",
        startHistoryId: historyId ?? undefined,
        historyTypes: ["messageAdded"],
        maxResults: 500,
        pageToken,
      });
      for (const h of res.data.history ?? []) {
        if (h.id) {
          const id = BigInt(h.id);
          if (maxRecordId === null || id > maxRecordId) maxRecordId = id;
        }
        for (const m of h.messagesAdded ?? []) {
          const labels = m.message?.labelIds ?? [];
          const excluded = ["SPAM", "TRASH", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL"];
          if (labels.some((l) => excluded.includes(l))) continue;
          if (m.message?.threadId) threadIds.add(m.message.threadId);
        }
      }
      if (res.data.historyId) newHistoryId = res.data.historyId;
      pageToken = res.data.nextPageToken ?? undefined;
      walkedAllPages = !pageToken;
    } while (pageToken && threadIds.size < THREADS_PER_RUN * 2 && Date.now() < deadline);
    if (!walkedAllPages) {
      newHistoryId = maxRecordId !== null ? String(maxRecordId) : historyId;
    }
  } catch (err) {
    if (errorStatus(err) === 404) {
      // The stored historyId aged out (Gmail keeps roughly a week). Re-seed
      // from the profile and sweep the last two days of threads.
      const profile = await gmail.users.getProfile({ userId: "me" });
      await mergeSyncState(supabase, account.id, { history_id: profile.data.historyId ?? null });
      const recent = await gmail.users.threads.list({
        userId: "me",
        q: "newer_than:2d -in:spam -in:trash -category:promotions -category:social",
        maxResults: THREADS_PER_RUN,
      });
      stats.mode = "reseed";
      for (const t of recent.data.threads ?? []) {
        if (Date.now() > deadline) break;
        if (t.id) await ingest(t.id);
      }
      return stats;
    }
    throw err;
  }

  let processedAll = true;
  for (const id of threadIds) {
    if (Date.now() > deadline) {
      processedAll = false;
      break;
    }
    await ingest(id);
  }
  // Only advance the cursor when the whole batch landed; re-reading history is
  // cheap and upserts are idempotent.
  if (processedAll && newHistoryId) {
    await mergeSyncState(supabase, account.id, { history_id: newHistoryId });
  }
  return stats;
}

async function ingestThread(opts: {
  supabase: SupabaseClient;
  userId: string;
  account: ConnectedAccount;
  gmail: gmail_v1.Gmail;
  threadId: string;
}): Promise<"created" | "changed" | "unchanged" | "skipped"> {
  const { supabase, userId, account, gmail, threadId } = opts;
  const { data } = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  const messages = data.messages ?? [];
  if (!messages.length) return "skipped";

  const parsed = messages.map(parseMessage);

  // SPEC §6.1: skip a thread where every message is a newsletter or a
  // no-reply sender. A human reply in the thread makes it worth archiving.
  const allNoise = parsed.every((m) => isNewsletterish(m.headers) || NO_REPLY.test(m.from));
  if (allNoise) return "skipped";

  const text = cleanEmailText(
    parsed.map((m) => ({
      from: m.from,
      to: m.to,
      cc: m.cc,
      date: m.date,
      subject: m.subject,
      textBody: m.body,
    })),
  );

  const title = parsed[0]?.subject || "(no subject)";
  const occurredAt = parsed.reduce<number>((max, m) => Math.max(max, m.timestamp), 0);

  const result = await upsertSourceItem(supabase, userId, {
    accountId: account.id,
    provider: "google",
    kind: "email_thread",
    externalId: `gmail:${account.id}:${threadId}`,
    externalUrl: `https://mail.google.com/mail/u/0/#all/${threadId}`,
    title,
    text,
    raw: { threadId, historyId: data.historyId, messageCount: messages.length },
    participants: collectParticipants(parsed),
    occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null,
    defaultDomainId: account.default_domain_id,
  });

  return result.changed ? "changed" : "unchanged";
}

interface ParsedMessage {
  headers: Record<string, string>;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  body: string;
  timestamp: number;
}

function parseMessage(msg: gmail_v1.Schema$Message): ParsedMessage {
  const headers: Record<string, string> = {};
  for (const h of msg.payload?.headers ?? []) {
    if (h.name && h.value) headers[h.name.toLowerCase()] = h.value;
  }
  const timestamp = msg.internalDate ? Number(msg.internalDate) : Date.parse(headers.date ?? "") || 0;
  return {
    headers,
    from: headers.from ?? "",
    to: headers.to ?? "",
    cc: headers.cc ?? "",
    subject: headers.subject ?? "",
    date: headers.date ?? (timestamp ? new Date(timestamp).toISOString() : ""),
    body: extractBody(msg.payload),
    timestamp,
  };
}

/** Prefer text/plain; fall back to the HTML part with tags stripped. */
function extractBody(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return "";
  const plain = findPart(part, "text/plain");
  if (plain) return decode(plain);
  const html = findPart(part, "text/html");
  if (html) return stripHtml(decode(html));
  return "";
}

function findPart(
  part: gmail_v1.Schema$MessagePart,
  mime: string,
): gmail_v1.Schema$MessagePart | null {
  if (part.mimeType === mime && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mime);
    if (found) return found;
  }
  return null;
}

function decode(part: gmail_v1.Schema$MessagePart): string {
  const data = part.body?.data;
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectParticipants(messages: ParsedMessage[]): SourceParticipant[] {
  const byEmail = new Map<string, SourceParticipant>();
  const add = (raw: string, role: string) => {
    for (const p of parseAddressList(raw)) {
      const key = p.email?.toLowerCase();
      if (!key || byEmail.has(key)) continue;
      byEmail.set(key, { ...p, role });
    }
  };
  for (const m of messages) {
    add(m.from, "from");
    add(m.to, "to");
    add(m.cc, "cc");
  }
  return [...byEmail.values()];
}

/** "Name <a@b.com>, c@d.com" → [{name, email}]. */
export function parseAddressList(raw: string): Array<{ name?: string; email?: string }> {
  if (!raw) return [];
  return raw
    .split(/,(?![^<]*>)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const angle = chunk.match(/^(.*?)<([^>]+)>$/);
      if (angle) {
        const name = angle[1]?.trim().replace(/^["']|["']$/g, "");
        return { name: name || undefined, email: angle[2]?.trim().toLowerCase() };
      }
      return { email: chunk.toLowerCase() };
    })
    .filter((p) => Boolean(p.email));
}
