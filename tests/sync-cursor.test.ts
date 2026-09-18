import { describe, expect, it } from "vitest";
import { ascendingPrefixCursor } from "@/lib/domain/sync-cursor";

const t = (day: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, day, 12, minute)).toISOString();

describe("ascendingPrefixCursor", () => {
  const ats = [t(1), t(2), t(3), t(4)];

  it("advances to the newest processed time when everything fetched was processed", () => {
    expect(ascendingPrefixCursor(null, ats, 4, true)).toBe(t(4));
    expect(ascendingPrefixCursor(t(1), ats, 4, true)).toBe(t(4));
  });

  it("advances to the oldest UNPROCESSED time on a truncated run", () => {
    // Items 0..1 processed; item 2 is the oldest thing the next run must see.
    expect(ascendingPrefixCursor(null, ats, 2, true)).toBe(t(3));
  });

  it("subtracts the safety margin on a truncated run when asked", () => {
    // Strictly-newer-than-cursor fetches with coarse timestamps (Notion):
    // the boundary item itself must still be > the stored cursor.
    const got = ascendingPrefixCursor(null, ats, 2, true, 60_000);
    expect(got).toBe(new Date(Date.parse(t(3)) - 60_000).toISOString());
    expect(got! < t(3)).toBe(true);
  });

  it("applies no safety margin on a clean run", () => {
    expect(ascendingPrefixCursor(null, ats, 4, true, 60_000)).toBe(t(4));
  });

  it("never advances when the fetch itself was not exhaustive", () => {
    // Unfetched items have unknown timestamps (stream order says nothing
    // about how old the unfetched remainder is), so any advance could skip
    // one forever.
    expect(ascendingPrefixCursor(null, ats, 4, false)).toBeNull();
    expect(ascendingPrefixCursor(null, ats, 2, false)).toBeNull();
  });

  it("never advances with zero progress or an empty batch", () => {
    expect(ascendingPrefixCursor(t(1), ats, 0, true)).toBeNull();
    expect(ascendingPrefixCursor(t(1), [], 0, true)).toBeNull();
  });

  it("never moves the cursor backward", () => {
    // Overlap re-reads can make the whole batch older than the cursor.
    expect(ascendingPrefixCursor(t(9), ats, 4, true)).toBeNull();
    expect(ascendingPrefixCursor(t(9), ats, 2, true)).toBeNull();
  });

  it("drains an overlap-read backlog across runs without skips (Granola shape)", () => {
    // 6 notes, 2 processed per run, fetched exhaustively each time. The real
    // route reads from cursor MINUS an overlap, so a note sitting exactly on
    // the cursor is refetched — model that with an inclusive filter.
    const all = [t(1), t(2), t(3), t(4), t(5), t(6)];
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let run = 0; run < 3; run++) {
      const fetched = all.filter((at) => !cursor || at >= cursor);
      const processed = Math.min(2, fetched.length);
      for (const at of fetched.slice(0, processed)) seen.add(at);
      const next = ascendingPrefixCursor(cursor, fetched, processed, true);
      expect(next).not.toBeNull();
      cursor = next;
    }
    expect(cursor).toBe(t(6));
    expect([...seen].sort()).toEqual(all); // every note processed, none skipped
  });

  it("drains a strictly-newer backlog across runs without skips (Notion shape)", () => {
    // Same-minute edits at the truncation boundary: the safety margin keeps
    // the boundary page fetchable by a strictly-newer-than-cursor query.
    const all = [t(1, 0), t(1, 5), t(1, 5), t(1, 9), t(2, 0), t(2, 0)];
    const seen = new Set<number>();
    let cursor: string | null = null;
    for (let run = 0; run < 4 && seen.size < all.length; run++) {
      const fetched = all
        .map((at, i) => ({ at, i }))
        .filter(({ at }) => !cursor || at > cursor); // strictly newer, like searchShared
      const processed = Math.min(2, fetched.length);
      for (const { i } of fetched.slice(0, processed)) seen.add(i);
      const next = ascendingPrefixCursor(
        cursor,
        fetched.map(({ at }) => at),
        processed,
        true,
        60_000,
      );
      if (next) cursor = next;
    }
    expect(seen.size).toBe(all.length); // every page ingested, none skipped
  });
});
