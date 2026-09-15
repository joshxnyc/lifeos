import { describe, expect, it } from "vitest";
import { daysSinceActivity, isDormant } from "@/lib/domain/dormancy";

const now = new Date("2026-09-15T12:00:00Z");

describe("isDormant", () => {
  it("is true at exactly the dormancy threshold", () => {
    expect(isDormant("2026-09-01T12:00:00Z", 14, now)).toBe(true);
  });

  it("is false just inside the threshold", () => {
    expect(isDormant("2026-09-01T13:00:00Z", 14, now)).toBe(false);
    expect(isDormant("2026-09-14T12:00:00Z", 14, now)).toBe(false);
  });

  it("is true well past the threshold", () => {
    expect(isDormant("2026-06-01T00:00:00Z", 14, now)).toBe(true);
  });

  it("respects a custom dormancy window", () => {
    expect(isDormant("2026-09-08T12:00:00Z", 7, now)).toBe(true);
    expect(isDormant("2026-09-08T12:00:00Z", 30, now)).toBe(false);
  });

  it("is false for activity in the future", () => {
    expect(isDormant("2026-10-01T00:00:00Z", 14, now)).toBe(false);
  });

  it("is false for an unparseable timestamp", () => {
    expect(isDormant("never", 14, now)).toBe(false);
    expect(isDormant("", 14, now)).toBe(false);
  });
});

describe("daysSinceActivity", () => {
  it("counts fractional days", () => {
    expect(daysSinceActivity("2026-09-14T00:00:00Z", now)).toBe(1.5);
  });

  it("is negative for a future timestamp", () => {
    expect(daysSinceActivity("2026-09-16T12:00:00Z", now)).toBe(-1);
  });

  it("is 0 for an unparseable timestamp", () => {
    expect(daysSinceActivity("nope", now)).toBe(0);
  });
});
