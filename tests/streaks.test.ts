import { describe, expect, it } from "vitest";
import { completionRate, computeStreaks } from "@/lib/domain/streaks";
import type { RoutineLog } from "@/lib/types";

type Log = Pick<RoutineLog, "date" | "status">;

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const TODAY = "2026-09-15"; // Tuesday

const done = (date: string): Log => ({ date, status: "done" });
const missed = (date: string): Log => ({ date, status: "missed" });
const skipped = (date: string): Log => ({ date, status: "skipped" });

describe("computeStreaks", () => {
  it("returns zeroes with no logs", () => {
    expect(computeStreaks([], EVERY_DAY, TODAY)).toEqual({ current: 0, best: 0 });
  });

  it("returns zeroes when the routine is scheduled on no days", () => {
    expect(computeStreaks([done("2026-09-14")], [], TODAY)).toEqual({ current: 0, best: 0 });
  });

  it("counts consecutive done days ending yesterday when today is not logged", () => {
    const logs = ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"].map(done);
    expect(computeStreaks(logs, EVERY_DAY, TODAY)).toEqual({ current: 5, best: 5 });
  });

  it("counts today when today is already done", () => {
    const logs = ["2026-09-13", "2026-09-14", "2026-09-15"].map(done);
    expect(computeStreaks(logs, EVERY_DAY, TODAY)).toEqual({ current: 3, best: 3 });
  });

  it("treats skipped days as transparent", () => {
    const logs: Log[] = [
      done("2026-09-10"),
      done("2026-09-11"),
      skipped("2026-09-12"),
      done("2026-09-13"),
      done("2026-09-14"),
    ];
    expect(computeStreaks(logs, EVERY_DAY, TODAY)).toEqual({ current: 4, best: 4 });
  });

  it("breaks the streak on a missed day", () => {
    const logs: Log[] = [
      done("2026-09-10"),
      done("2026-09-11"),
      missed("2026-09-12"),
      done("2026-09-13"),
      done("2026-09-14"),
    ];
    expect(computeStreaks(logs, EVERY_DAY, TODAY)).toEqual({ current: 2, best: 2 });
  });

  it("breaks the streak on a scheduled past day with no log at all", () => {
    const logs = ["2026-09-10", "2026-09-11", "2026-09-13", "2026-09-14"].map(done);
    expect(computeStreaks(logs, EVERY_DAY, TODAY)).toEqual({ current: 2, best: 2 });
  });

  it("breaks the streak when today is already marked missed", () => {
    const logs: Log[] = [done("2026-09-13"), done("2026-09-14"), missed("2026-09-15")];
    expect(computeStreaks(logs, EVERY_DAY, TODAY)).toEqual({ current: 0, best: 2 });
  });

  it("ignores days the routine is not scheduled on", () => {
    // Fri 11th and Mon 14th are consecutive scheduled days; the weekend is not.
    const logs = [done("2026-09-11"), done("2026-09-14")];
    expect(computeStreaks(logs, WEEKDAYS, TODAY)).toEqual({ current: 2, best: 2 });
  });

  it("keeps the best streak from earlier than the current one", () => {
    const logs: Log[] = [
      ...["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].map(done),
      missed("2026-09-05"),
      ...["2026-09-06", "2026-09-07"].map(done),
      missed("2026-09-08"),
      ...["2026-09-13", "2026-09-14"].map(done),
    ];
    // 9th–12th have no logs at all, so the current run is only the 13th–14th.
    expect(computeStreaks(logs, EVERY_DAY, TODAY)).toEqual({ current: 2, best: 4 });
  });

  it("ignores logs dated after today", () => {
    const logs = [done("2026-09-14"), done("2026-09-16")];
    expect(computeStreaks(logs, EVERY_DAY, TODAY)).toEqual({ current: 1, best: 1 });
  });

  it("lets the last row for a date win", () => {
    const logs: Log[] = [missed("2026-09-14"), done("2026-09-14")];
    expect(computeStreaks(logs, EVERY_DAY, TODAY)).toEqual({ current: 1, best: 1 });
  });
});

describe("completionRate", () => {
  it("is 1 when every scheduled day in the window was done and today is pending", () => {
    const logs = [
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
    ].map(done);
    expect(completionRate(logs, EVERY_DAY, TODAY, 10)).toBe(1);
  });

  it("excludes skipped days from the denominator", () => {
    const logs: Log[] = [done("2026-09-13"), skipped("2026-09-14"), done("2026-09-15")];
    expect(completionRate(logs, EVERY_DAY, TODAY, 3)).toBe(1);
  });

  it("counts missed days against the rate", () => {
    const logs: Log[] = [done("2026-09-13"), missed("2026-09-14"), done("2026-09-15")];
    expect(completionRate(logs, EVERY_DAY, TODAY, 3)).toBeCloseTo(2 / 3, 10);
  });

  it("counts a scheduled past day with no log against the rate", () => {
    const logs: Log[] = [done("2026-09-13"), done("2026-09-15")];
    expect(completionRate(logs, EVERY_DAY, TODAY, 3)).toBeCloseTo(2 / 3, 10);
  });

  it("does not count today against the rate while it is unlogged", () => {
    const logs: Log[] = [done("2026-09-13"), done("2026-09-14")];
    expect(completionRate(logs, EVERY_DAY, TODAY, 3)).toBe(1);
  });

  it("only counts scheduled weekdays", () => {
    // Window 2026-09-09..15 holds weekdays 9, 10, 11, 14, 15; today is pending.
    const logs: Log[] = [
      done("2026-09-09"),
      done("2026-09-10"),
      missed("2026-09-11"),
      done("2026-09-14"),
    ];
    expect(completionRate(logs, WEEKDAYS, TODAY, 7)).toBeCloseTo(3 / 4, 10);
  });

  it("returns 0 for an empty log, no schedule or a non-positive window", () => {
    expect(completionRate([], EVERY_DAY, TODAY, 28)).toBe(0);
    expect(completionRate([done("2026-09-14")], [], TODAY, 28)).toBe(0);
    expect(completionRate([done("2026-09-14")], EVERY_DAY, TODAY, 0)).toBe(0);
  });

  it("measures a 28-day window ending today", () => {
    // Done every day from 2026-08-19 (28 days back) to yesterday, bar one miss.
    const logs: Log[] = [];
    for (let i = 27; i >= 1; i--) {
      const d = new Date(Date.UTC(2026, 8, 15));
      d.setUTCDate(d.getUTCDate() - i);
      logs.push(done(d.toISOString().slice(0, 10)));
    }
    logs.push(missed("2026-09-01"));
    expect(completionRate(logs, EVERY_DAY, TODAY, 28)).toBeCloseTo(26 / 27, 10);
  });
});
