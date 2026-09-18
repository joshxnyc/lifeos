// Cursor advancement for truncated sync runs. Pure on purpose: the sync jobs
// (Notion, Granola) feed in what they fetched and processed and get back either
// a new cursor or null ("do not advance").
//
// The invariant: the cursor only ever advances past a timestamp when every item
// at or before it has been ingested. Never advancing on a truncated run (the
// old behavior) satisfies that trivially but livelocks on a persistent
// oversized backlog — every run refetches and re-processes the same head. The
// sound way to get both safety and progress:
//
//   1. Fetch item HEADERS exhaustively for everything newer than the cursor
//      (headers are cheap; the expensive part is hydrating each item).
//   2. Sort ascending and process OLDEST-FIRST up to the processing budget.
//   3. On truncation, advance to the oldest UNPROCESSED timestamp: everything
//      older was just processed, everything unprocessed is at or after it and
//      is refetched next run. Each run then drains a slice from the bottom.
//
// Processing oldest-first is what makes this work. Any fixed order with a
// pinned cursor re-processes the same slice forever; newest-first processing
// can never advance safely because the source's stream order says nothing
// about how old its unfetched remainder is (edit times have gaps).
//
// When the FETCH itself was cut short (page cap, deadline, error), unfetched
// items have unknown timestamps and no advance is safe — the cursor stays put.
// That is the one residual livelock, so callers keep their header-fetch budget
// well above any realistic backlog.

/**
 * @param prev            the stored cursor, or null on the first run.
 * @param ascendingAts    timestamps of every item fetched this run, sorted
 *                        ascending; the run processed a prefix of this list.
 * @param processedCount  how many items of that prefix were processed.
 * @param exhausted       true when the fetch delivered everything the source
 *                        had that was newer than `prev` — false on a page cap,
 *                        deadline during the fetch, or a fetch error.
 * @param safetyMs        subtracted from a truncation boundary. Use it when
 *                        the next fetch is STRICTLY-newer-than-cursor and
 *                        timestamps are coarse (Notion's last_edited_time has
 *                        minute granularity), so an unprocessed item sitting
 *                        exactly on the boundary is still refetched. Callers
 *                        whose next read applies an overlap (Granola) need 0.
 * @returns the cursor to store, or null to leave it alone.
 */
export function ascendingPrefixCursor(
  prev: string | null,
  ascendingAts: readonly string[],
  processedCount: number,
  exhausted: boolean,
  safetyMs = 0,
): string | null {
  if (!exhausted) return null;
  if (processedCount <= 0 || ascendingAts.length === 0) return null;

  let candidate: string | undefined;
  if (processedCount < ascendingAts.length) {
    // Truncated: land just before the oldest unprocessed item. Everything
    // unprocessed is >= it, so all of it comes back next run; everything
    // < it was processed this run (ascending prefix).
    const bound = ascendingAts[processedCount];
    if (!bound) return null;
    if (safetyMs > 0) {
      const parsed = Date.parse(bound);
      if (Number.isNaN(parsed)) return null;
      candidate = new Date(parsed - safetyMs).toISOString();
    } else {
      candidate = bound;
    }
  } else {
    // Clean run: everything fetched was processed.
    candidate = ascendingAts[ascendingAts.length - 1];
  }

  if (!candidate) return null;
  return !prev || candidate > prev ? candidate : null;
}
