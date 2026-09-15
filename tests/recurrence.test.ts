import { describe, expect, it } from "vitest";
import { nextOccurrence } from "@/lib/domain/recurrence";

describe("nextOccurrence", () => {
  it("spawns the next weekly occurrence from a rule with no DTSTART", () => {
    // No anchor: the rule is anchored on the date it is asked about.
    expect(nextOccurrence("FREQ=WEEKLY", "2026-09-15")).toBe("2026-09-22");
    expect(nextOccurrence("RRULE:FREQ=WEEKLY", "2026-09-15")).toBe("2026-09-22");
  });

  it("honours BYDAY without a DTSTART", () => {
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=MO", "2026-09-15")).toBe("2026-09-21");
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=MO,WE,FR", "2026-09-15")).toBe("2026-09-16");
    expect(nextOccurrence("FREQ=WEEKLY;BYDAY=MO,WE,FR", "2026-09-16")).toBe("2026-09-18");
  });

  it("handles intervals", () => {
    expect(nextOccurrence("FREQ=DAILY;INTERVAL=3", "2026-09-15")).toBe("2026-09-18");
    expect(nextOccurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", "2026-09-15")).toBe("2026-09-29");
  });

  it("spawns the next monthly occurrence", () => {
    expect(nextOccurrence("FREQ=MONTHLY", "2026-09-15")).toBe("2026-10-15");
    expect(nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=1", "2026-09-15")).toBe("2026-10-01");
    expect(nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=-1", "2026-09-15")).toBe("2026-09-30");
  });

  it("crosses a year boundary", () => {
    expect(nextOccurrence("FREQ=MONTHLY;BYMONTHDAY=5", "2026-12-10")).toBe("2027-01-05");
    expect(nextOccurrence("FREQ=YEARLY", "2026-09-15")).toBe("2027-09-15");
  });

  it("uses an explicit DTSTART as the anchor", () => {
    const rule = "DTSTART:20260901T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=TU";
    expect(nextOccurrence(rule, "2026-09-15")).toBe("2026-09-22");
    expect(nextOccurrence(rule, "2026-09-14")).toBe("2026-09-15");
  });

  it("parses the DTSTART forms rrule itself does not", () => {
    // rrule@2 silently falls back to the current clock for these, which would
    // make the function impure; they are normalised before parsing.
    expect(nextOccurrence("DTSTART;VALUE=DATE:20260901\nRRULE:FREQ=MONTHLY;BYMONTHDAY=1", "2026-09-15")).toBe(
      "2026-10-01",
    );
    expect(
      nextOccurrence("DTSTART;TZID=America/New_York:20260901T090000\nRRULE:FREQ=WEEKLY;BYDAY=TU", "2026-09-15"),
    ).toBe("2026-09-22");
  });

  it("treats DTSTART times as floating local dates", () => {
    // 23:00 in a rule must not roll the spawned date forward a day.
    expect(nextOccurrence("DTSTART:20260901T230000Z\nRRULE:FREQ=DAILY", "2026-09-15")).toBe("2026-09-16");
  });

  it("returns dates strictly after `after`", () => {
    expect(nextOccurrence("DTSTART:20260915T090000Z\nRRULE:FREQ=DAILY", "2026-09-15")).toBe("2026-09-16");
  });

  it("accepts \\r\\n line endings", () => {
    expect(nextOccurrence("DTSTART:20260901T000000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=TU", "2026-09-15")).toBe("2026-09-22");
  });

  it("returns null when the rule is exhausted", () => {
    expect(nextOccurrence("DTSTART:20260901T000000Z\nRRULE:FREQ=MONTHLY;BYMONTHDAY=1;COUNT=2", "2026-10-01")).toBeNull();
    expect(nextOccurrence("DTSTART:20260901T000000Z\nRRULE:FREQ=WEEKLY;UNTIL=20260910T000000Z", "2026-09-15")).toBeNull();
  });

  it("returns null for junk input", () => {
    expect(nextOccurrence("not a rule", "2026-09-15")).toBeNull();
    expect(nextOccurrence("", "2026-09-15")).toBeNull();
    expect(nextOccurrence("DTSTART:20260901T000000Z", "2026-09-15")).toBeNull();
    expect(nextOccurrence("FREQ=WEEKLY", "not-a-date")).toBeNull();
    expect(nextOccurrence("FREQ=WEEKLY", "2026-13-40")).toBeNull();
  });

  it("is pure: the same inputs give the same answer", () => {
    const a = nextOccurrence("FREQ=WEEKLY;BYDAY=FR", "2026-09-15");
    const b = nextOccurrence("FREQ=WEEKLY;BYDAY=FR", "2026-09-15");
    expect(a).toBe(b);
    expect(a).toBe("2026-09-18");
  });
});
