import { describe, expect, it } from "vitest";
import {
  ascendingPrefixCursor,
  descendingStreamsCursor,
  DESCENDING_BOUNDARY_SAFETY_MS,
  type StreamProgress,
} from "@/lib/domain/sync-cursor";

const t = (day: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, day, 12, minute)).toISOString();

const stream = (oldestHandled: string | null, truncated: boolean): StreamProgress => ({
  oldestHandled,
  truncated,
});

describe("descendingStreamsCursor", () => {
  it("advances to the newest handled time on a clean run", () => {
    expect(descendingStreamsCursor(t(1), t(5), [stream(t(2), false)])).toBe(t(5));
  });

  it("does not move backward or sideways on a clean run", () => {
    expect(descendingStreamsCursor(t(5), t(5), [stream(t(2), false)])).toBeNull();
    expect(descendingStreamsCursor(t(6), t(5), [stream(t(2), false)])).toBeNull();
    expect(descendingStreamsCursor(t(5), null, [])).toBeNull();
  });

  it("advances to the oldest handled time of a truncated stream, minus the safety margin", () => {
    const got = descendingStreamsCursor(t(1), t(9), [stream(t(4), true)]);
    expect(got).toBe(new Date(Date.parse(t(4)) - DESCENDING_BOUNDARY_SAFETY_MS).toISOString());
  });

  it("takes the minimum across several truncated streams and ignores complete ones", () => {
    const got = descendingStreamsCursor(t(1), t(9), [
      stream(t(6), true),
      stream(t(3), true),
      stream(t(2), false), // complete: everything it had was handled
    ]);
    expect(got).toBe(new Date(Date.parse(t(3)) - DESCENDING_BOUNDARY_SAFETY_MS).toISOString());
  });

  it("pins the cursor when a truncated stream handled nothing (e.g. an errored database)", () => {
    expect(
      descendingStreamsCursor(t(1), t(9), [stream(t(6), true), stream(null, true)]),
    ).toBeNull();
  });

  it("pins the cursor when the boundary would not move it forward", () => {
    // A truncated stream whose oldest handled item sits inside the safety
    // margin of the previous cursor: no progress, but also no skip.
    expect(descendingStreamsCursor(t(5), t(9), [stream(t(5), true)])).toBeNull();
  });

  it("covers the same-minute edit edge: an unhandled page sharing the boundary timestamp is refetched", () => {
    // Two pages edited at t(4); the stream was cut between them. The cursor
    // lands strictly below t(4), so a next fetch of "newer than cursor" still
    // returns the one we missed.
    const got = descendingStreamsCursor(t(1), t(9), [stream(t(4), true)]);
    expect(got).not.toBeNull();
    expect(got! < t(4)).toBe(true);
  });

  it("guarantees progress on a persistent oversized backlog", () => {
    // Every run handles a slice and the boundary keeps moving: no livelock.
    let cursor: string | null = t(1);
    const boundaries = [t(3), t(5), t(7)];
    for (const oldest of boundaries) {
      const next = descendingStreamsCursor(cursor, t(9), [stream(oldest, true)]);
      expect(next).not.toBeNull();
      expect(next! > (cursor ?? "")).toBe(true);
      cursor = next;
    }
  });
});

describe("ascendingPrefixCursor", () => {
  const ats = [t(1), t(2), t(3), t(4)];

  it("advances to the newest processed time when everything fetched was processed", () => {
    expect(ascendingPrefixCursor(null, ats, 4, true)).toBe(t(4));
  });

  it("advances to the oldest UNPROCESSED time on a truncated run", () => {
    // Items 0..1 processed; item 2 is the oldest thing the next run must see.
    expect(ascendingPrefixCursor(null, ats, 2, true)).toBe(t(3));
  });

  it("never advances when the fetch itself was not exhaustive", () => {
    // Unfetched notes have unknown timestamps (the source's order is not
    // contract-stable), so any advance could skip one forever.
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

  it("drains a backlog across runs without skips", () => {
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
});
