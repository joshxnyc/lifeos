import { describe, expect, it } from "vitest";
import { dayOfWeekOf, diffDays, eachDate, formatDateParts, isDateString } from "@/lib/domain/dates";

describe("isDateString", () => {
  it("accepts real calendar dates", () => {
    expect(isDateString("2026-09-15")).toBe(true);
    expect(isDateString("2024-02-29")).toBe(true);
  });

  it("rejects malformed or impossible dates", () => {
    expect(isDateString("2026-9-15")).toBe(false);
    expect(isDateString("2026-13-01")).toBe(false);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("tomorrow")).toBe(false);
    expect(isDateString("")).toBe(false);
  });
});

describe("dayOfWeekOf", () => {
  it("returns 0 for Sunday, matching routines.schedule_days", () => {
    expect(dayOfWeekOf("2026-09-13")).toBe(0);
    expect(dayOfWeekOf("2026-09-14")).toBe(1);
    expect(dayOfWeekOf("2026-09-15")).toBe(2);
    expect(dayOfWeekOf("2026-09-19")).toBe(6);
  });
});

describe("diffDays", () => {
  it("counts whole days in both directions", () => {
    expect(diffDays("2026-09-15", "2026-09-18")).toBe(3);
    expect(diffDays("2026-09-18", "2026-09-15")).toBe(-3);
    expect(diffDays("2026-09-15", "2026-09-15")).toBe(0);
  });

  it("crosses a DST change without drifting", () => {
    // 2026-11-01 is the US DST fall-back; these are floating dates regardless.
    expect(diffDays("2026-10-31", "2026-11-02")).toBe(2);
    expect(diffDays("2026-03-07", "2026-03-09")).toBe(2);
  });

  it("crosses month and year boundaries", () => {
    expect(diffDays("2026-12-31", "2027-01-01")).toBe(1);
    expect(diffDays("2026-02-28", "2026-03-01")).toBe(1);
  });
});

describe("eachDate", () => {
  it("is inclusive of both ends", () => {
    expect(eachDate("2026-09-13", "2026-09-16")).toEqual([
      "2026-09-13",
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
    ]);
  });

  it("returns a single date when start equals end", () => {
    expect(eachDate("2026-09-15", "2026-09-15")).toEqual(["2026-09-15"]);
  });

  it("returns nothing when end is before start", () => {
    expect(eachDate("2026-09-15", "2026-09-14")).toEqual([]);
  });
});

describe("formatDateParts", () => {
  it("pads to YYYY-MM-DD", () => {
    expect(formatDateParts(2026, 9, 5)).toBe("2026-09-05");
    expect(formatDateParts(2026, 12, 31)).toBe("2026-12-31");
  });
});
