import { describe, expect, it } from "vitest";
import { addDays, isDueNow, mondayOf } from "@/lib/time";

describe("isDueNow", () => {
  it("fires on the exact minute", () => {
    expect(isDueNow("07:00", "07:00")).toBe(true);
    expect(isDueNow("00:00", "00:00")).toBe(true);
  });

  it("fires anywhere inside the window after the target", () => {
    expect(isDueNow("07:01", "07:00")).toBe(true);
    expect(isDueNow("07:14", "07:00")).toBe(true);
  });

  it("does not fire once the window has passed", () => {
    expect(isDueNow("07:15", "07:00")).toBe(false);
    expect(isDueNow("08:00", "07:00")).toBe(false);
  });

  it("does not fire before the target (just-missed tick)", () => {
    expect(isDueNow("06:59", "07:00")).toBe(false);
    expect(isDueNow("06:45", "07:00")).toBe(false);
  });

  it("fires for a target in the last window before midnight", () => {
    // 23:50 target, 15-minute ticks: the next tick is 00:00 the following day.
    expect(isDueNow("00:00", "23:50")).toBe(true);
    expect(isDueNow("00:04", "23:50")).toBe(true);
    expect(isDueNow("23:50", "23:50")).toBe(true);
    expect(isDueNow("23:55", "23:50")).toBe(true);
  });

  it("does not fire past the window across midnight", () => {
    expect(isDueNow("00:05", "23:50")).toBe(false);
    expect(isDueNow("01:00", "23:50")).toBe(false);
  });

  it("honours a custom window", () => {
    expect(isDueNow("07:30", "07:00", 60)).toBe(true);
    expect(isDueNow("00:30", "23:45", 60)).toBe(true);
    expect(isDueNow("08:00", "07:00", 60)).toBe(false);
  });
});

describe("mondayOf", () => {
  it("returns the Monday of the containing week", () => {
    expect(mondayOf("2026-09-15")).toBe("2026-09-14"); // Tuesday
    expect(mondayOf("2026-09-14")).toBe("2026-09-14"); // Monday itself
    expect(mondayOf("2026-09-13")).toBe("2026-09-07"); // Sunday belongs to the week before
  });
});

describe("addDays", () => {
  it("moves across month boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});
