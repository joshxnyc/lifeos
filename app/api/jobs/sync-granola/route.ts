import { jobRoute } from "@/lib/jobs";
import { serverEnv } from "@/lib/env";
import { markSynced, mergeSyncState, setAccountError, safeErrorMessage } from "@/lib/integrations/accounts";
import { ascendingPrefixCursor } from "@/lib/domain/sync-cursor";
import { getGranolaClient } from "@/lib/integrations/granola";
import { ensureGranolaAccount } from "@/lib/integrations/granola/oauth-provider";
import { upsertSourceItem } from "@/lib/integrations/source-items";
import type { GranolaNote } from "@/lib/integrations/granola";
import type { ConnectedAccount } from "@/lib/types";

/**
 * Every 30 minutes: pull Granola meeting notes into the archive (SPEC §6.3).
 * Cursor is `created_after` minus a two-day overlap, because Granola only
 * returns notes whose AI summary has finished and a late summary would
 * otherwise fall behind the cursor. Re-fetches are free: upsertSourceItem
 * compares the content hash and only re-opens extraction when it moved.
 *
 * Adding a future source is the same three pieces and nothing more (SPEC
 * §6.4): a provider value, an adapter that writes source_items, and a sync
 * job. Extraction, search, people-linking and the queue need no changes.
 */
const OVERLAP_DAYS = 2;
/** Rolling window: the first run backfills the last 7 days, like Gmail. */
const INITIAL_BACKFILL_DAYS = 7;
/** Notes fully processed per run (transcript fetch + upsert). */
const MAX_NOTES = 50;
/**
 * Note HEADERS buffered per run. Headers are cheap (transcripts are hydrated
 * only for processed notes); this cap just bounds memory. The cursor can only
 * advance past unprocessed notes when the listing was exhaustive, so it sits
 * far above any realistic backlog.
 */
const FETCH_BUDGET = 300;

export const maxDuration = 60;

export const POST = jobRoute("sync-granola", async ({ supabase, userId }) => {
  const started = Date.now();
  const deadline = started + 45_000;

  const hasApiKey = Boolean(serverEnv().GRANOLA_API_KEY);
  const { data: existing } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "granola")
    .maybeSingle();
  let account = existing as ConnectedAccount | null;

  if (!account && !hasApiKey) return { skipped: "Granola not connected" };
  if (!account) account = await ensureGranolaAccount(supabase, userId);

  let client;
  try {
    client = await getGranolaClient(supabase, userId);
  } catch (err) {
    await setAccountError(supabase, account.id, safeErrorMessage(err));
    return { error: safeErrorMessage(err), notes: 0 };
  }
  if (!client) return { skipped: "Granola not connected" };

  const state = (account.sync_state ?? {}) as { created_after?: string };
  const since = state.created_after
    ? new Date(Date.parse(state.created_after) - OVERLAP_DAYS * 86_400_000).toISOString()
    : new Date(Date.now() - 30 * 86_400_000).toISOString();

  let notes = 0;
  let changed = 0;
  let newest = state.created_after ?? null;
  // A run cut short must not advance the cursor past notes it never fetched;
  // the 2-day overlap only protects against late summaries, not a >MAX_NOTES
  // backlog (e.g. the first sync of a busy month).
  let truncated = false;

  try {
    for await (const note of client.listNotes(since)) {
      if (notes >= MAX_NOTES || Date.now() > deadline) {
        truncated = true;
        break;
      }
      notes += 1;

      const text = [
        note.summary,
        note.myNotes ? `My notes:\n${note.myNotes}` : "",
        note.transcript ? `Transcript:\n${note.transcript}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const result = await upsertSourceItem(supabase, userId, {
        accountId: account.id,
        provider: "granola",
        kind: "granola_note",
        externalId: `granola:${note.id}`,
        externalUrl: note.url,
        title: note.title,
        text,
        raw: { id: note.id, has_transcript: Boolean(note.transcript) },
        participants: note.attendees.map((a) => ({ name: a.name, email: a.email, role: "attendee" })),
        occurredAt: note.occurredAt,
        defaultDomainId: account.default_domain_id,
      });
      if (result.changed) changed += 1;
      if (!newest || note.occurredAt > newest) newest = note.occurredAt;
    }
  } catch (err) {
    // Never crash the job on the MCP/API path — record it on the account and
    // report what we did manage to fetch.
    const message = safeErrorMessage(err);
    await supabase
      .from("connected_accounts")
      .update({ last_error: message, status: /unauthor|reconnect|invalid/i.test(message) ? "needs_reauth" : account.status })
      .eq("id", account.id);
    return { adapter: client.adapter, notes, changed, error: message, ms: Date.now() - started };
  }

  if (newest && !truncated) await mergeSyncState(supabase, account.id, { created_after: newest });
  await markSynced(supabase, account.id);

  return { adapter: client.adapter, notes, changed, truncated, cursor: newest, ms: Date.now() - started };
});
