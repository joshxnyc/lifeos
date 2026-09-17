import { describe, expect, it } from "vitest";
import { extractionOffset, reviewedUpto } from "@/lib/domain/extraction-window";

describe("extractionOffset", () => {
  it("reads a recorded offset inside the text", () => {
    expect(extractionOffset({ extracted_upto: 500 }, 800)).toBe(500);
    expect(extractionOffset({ threadId: "t1", extracted_upto: 1 }, 2)).toBe(1);
  });

  it("falls back to the full text when raw carries no marker", () => {
    expect(extractionOffset(null, 800)).toBe(0);
    expect(extractionOffset(undefined, 800)).toBe(0);
    expect(extractionOffset({}, 800)).toBe(0);
    expect(extractionOffset({ threadId: "t1" }, 800)).toBe(0);
    expect(extractionOffset("not an object", 800)).toBe(0);
    expect(extractionOffset([500], 800)).toBe(0);
  });

  it("falls back on corrupt markers", () => {
    expect(extractionOffset({ extracted_upto: "500" }, 800)).toBe(0);
    expect(extractionOffset({ extracted_upto: 12.5 }, 800)).toBe(0);
    expect(extractionOffset({ extracted_upto: -1 }, 800)).toBe(0);
    expect(extractionOffset({ extracted_upto: 0 }, 800)).toBe(0);
    expect(extractionOffset({ extracted_upto: Number.NaN }, 800)).toBe(0);
  });

  it("falls back when the offset is at or past the end of the current text", () => {
    // A rewritten (shorter) thread must never hide content from the model.
    expect(extractionOffset({ extracted_upto: 800 }, 800)).toBe(0);
    expect(extractionOffset({ extracted_upto: 900 }, 800)).toBe(0);
  });
});

describe("reviewedUpto", () => {
  it("advances to the end of a text that fits the cap", () => {
    expect(reviewedUpto(0, 800, 24_000)).toBe(800);
    expect(reviewedUpto(500, 900, 24_000)).toBe(900);
  });

  it("stops at the cap for oversized texts, so the rest is picked up later", () => {
    expect(reviewedUpto(0, 50_000, 24_000)).toBe(24_000);
    expect(reviewedUpto(24_000, 50_000, 24_000)).toBe(48_000);
  });

  it("round-trips with extractionOffset", () => {
    const upto = reviewedUpto(0, 800, 24_000);
    // Reply arrives, text grows to 1,000 chars: next pass reads from 800.
    expect(extractionOffset({ extracted_upto: upto }, 1000)).toBe(800);
    // No growth: full-text fallback, nothing is hidden.
    expect(extractionOffset({ extracted_upto: upto }, 800)).toBe(0);
  });
});
