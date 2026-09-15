import { describe, expect, it } from "vitest";
import { normalizeForDedupe, suggestionDedupeKey } from "@/lib/domain/dedupe";

describe("normalizeForDedupe", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeForDedupe("  Send the LP  consent memo!! ")).toBe("send the lp consent memo");
  });

  it("strips accents", () => {
    expect(normalizeForDedupe("Café résumé")).toBe("cafe resume");
  });

  it("keeps digits", () => {
    expect(normalizeForDedupe("Wire $25,000 by Q4")).toBe("wire 25 000 by q4");
  });
});

describe("suggestionDedupeKey", () => {
  it("is stable across calls", () => {
    const a = suggestionDedupeKey("Send the data room", "2026-09-20", "person-1");
    const b = suggestionDedupeKey("Send the data room", "2026-09-20", "person-1");
    expect(a).toBe(b);
  });

  it("returns a 16-character hex string", () => {
    expect(suggestionDedupeKey("anything", null, null)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("ignores case, punctuation and whitespace differences in the title", () => {
    const a = suggestionDedupeKey("Send the data room.", "2026-09-20", "person-1");
    const b = suggestionDedupeKey("  send  the DATA room  ", "2026-09-20", "person-1");
    expect(a).toBe(b);
  });

  it("treats null and undefined the same", () => {
    expect(suggestionDedupeKey("Ping Bernhard", null, null)).toBe(
      suggestionDedupeKey("Ping Bernhard", undefined, undefined),
    );
  });

  it("separates on due date", () => {
    expect(suggestionDedupeKey("Ping Bernhard", "2026-09-20", null)).not.toBe(
      suggestionDedupeKey("Ping Bernhard", "2026-09-21", null),
    );
    expect(suggestionDedupeKey("Ping Bernhard", "2026-09-20", null)).not.toBe(
      suggestionDedupeKey("Ping Bernhard", null, null),
    );
  });

  it("separates on person", () => {
    expect(suggestionDedupeKey("Ping them", null, "person-1")).not.toBe(
      suggestionDedupeKey("Ping them", null, "person-2"),
    );
  });

  it("separates on title", () => {
    expect(suggestionDedupeKey("Ping Bernhard", null, null)).not.toBe(suggestionDedupeKey("Ping Ben", null, null));
  });

  it("does not let field boundaries bleed into each other", () => {
    expect(suggestionDedupeKey("a", "b", "c")).not.toBe(suggestionDedupeKey("a b", null, "c"));
  });

  it("spreads similar titles across different keys", () => {
    const keys = new Set(
      ["Send the memo", "Send the memos", "Send a memo", "Send the meno", "send the memo 2"].map((t) =>
        suggestionDedupeKey(t, "2026-09-20", null),
      ),
    );
    expect(keys.size).toBe(5);
  });
});
