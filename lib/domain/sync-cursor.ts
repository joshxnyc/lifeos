// Cursor advancement for truncated sync runs. Pure on purpose: the sync jobs
// (Notion, Granola) feed in what they managed to process and get back either a
// new cursor or null ("do not advance"). The invariant both functions protect:
// after any run, every item the source holds that is newer than the stored
// cursor has either been ingested or will be returned by the next run's fetch.
// Never advancing (the old behavior) satisfies that trivially but livelocks on
// a persistent oversized backlog — every run refetches the same head. These
// boundaries advance as far as is provably safe, so a big backlog drains a
// slice per run instead of stalling forever.

export interface StreamProgress {
  /**
   * The oldest timestamp this stream handled this run ("handled" = ingested
   * now, or skipped only because another stream ingested the same page earlier
   * in the same run). Null when the stream handled nothing.
   */
  oldestHandled: string | null;
  /**
   * True when the stream may hold items this run did not deliver: it was cut
   * off by a budget or deadline, its fetch hit a page cap, or it errored.
   */
  truncated: boolean;
}

/**
 * Subtracted from a descending-streams boundary. Notion's last_edited_time has
 * minute granularity, so a stream cut between two pages edited in the same
 * minute would otherwise strand the unfetched one exactly at the cursor
 * (searchShared fetches strictly newer than the cursor).
 */
export const DESCENDING_BOUNDARY_SAFETY_MS = 60_000;

/**
 * Several streams, each yielding items newest-first (Notion: the shared-pages
 * search plus one stream per configured database).
 *
 * Invariant: within one descending stream, everything NOT handled is at most
 * as new as the oldest item that was handled. So a truncated stream's unseen
 * items all satisfy t <= oldestHandled(stream), and a cursor at
 * min(oldestHandled over truncated streams) - safety refetches every one of
 * them next run. Complete streams constrain nothing. A truncated stream that
 * handled nothing (including an errored one) pins the cursor: its unseen items
 * could be barely newer than the previous cursor.
 *
 * Returns the cursor to store, or null to leave it alone.
 */
export function descendingStreamsCursor(
  prev: string | null,
  newestHandled: string | null,
  streams: StreamProgress[],
  safetyMs: number = DESCENDING_BOUNDARY_SAFETY_MS,
): string | null {
  const truncated = streams.filter((s) => s.truncated);

  if (truncated.length === 0) {
    // Clean run: everything newer than prev was handled.
    if (!newestHandled) return null;
    return !prev || newestHandled > prev ? newestHandled : null;
  }

  let bound: string | null = null;
  for (const s of truncated) {
    if (s.oldestHandled === null) return null; // zero progress somewhere: pin
    if (bound === null || s.oldestHandled < bound) bound = s.oldestHandled;
  }
  if (bound === null) return null;

  const parsed = Date.parse(bound);
  if (Number.isNaN(parsed)) return null;
  const candidate = new Date(parsed - safetyMs).toISOString();
  return !prev || candidate > prev ? candidate : null;
}

/**
 * One fetched batch, sorted ascending by timestamp, processed as a prefix
 * (Granola). The source's own order is not contract-stable, so the caller
 * buffers what the adapter returned, sorts it, and processes oldest-first.
 *
 * Invariants:
 * - Processing truncated (processedCount < ascendingAts.length): every
 *   unprocessed item sits at or after ascendingAts[processedCount], so a
 *   cursor there refetches all of them (the caller's read-side overlap also
 *   absorbs equal timestamps). Safe only when the fetch itself was exhaustive;
 *   otherwise unfetched items of unknown age forbid any advance.
 * - Everything processed: advance to the newest processed timestamp, again
 *   only when the fetch was exhaustive.
 *
 * Returns the cursor to store, or null to leave it alone.
 */
export function ascendingPrefixCursor(
  prev: string | null,
  ascendingAts: readonly string[],
  processedCount: number,
  exhausted: boolean,
): string | null {
  if (!exhausted) return null;
  if (processedCount <= 0 || ascendingAts.length === 0) return null;

  const candidate =
    processedCount < ascendingAts.length
      ? ascendingAts[processedCount] // oldest unprocessed
      : ascendingAts[ascendingAts.length - 1]; // newest processed

  if (!candidate) return null;
  return !prev || candidate > prev ? candidate : null;
}
