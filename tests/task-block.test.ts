import { describe, expect, it } from "vitest";
import { blockMinutesForTask, DEFAULT_TASK_MINUTES, MIN_BLOCK_MINUTES } from "@/lib/domain/task-block";

describe("blockMinutesForTask", () => {
  it("uses the task's estimate when present", () => {
    expect(blockMinutesForTask(45)).toBe(45);
    expect(blockMinutesForTask(90)).toBe(90);
  });

  it("defaults to an hour without an estimate", () => {
    expect(blockMinutesForTask(null)).toBe(DEFAULT_TASK_MINUTES);
    expect(blockMinutesForTask(undefined)).toBe(DEFAULT_TASK_MINUTES);
  });

  it("floors short estimates at 15 minutes", () => {
    expect(blockMinutesForTask(1)).toBe(MIN_BLOCK_MINUTES);
    expect(blockMinutesForTask(14)).toBe(MIN_BLOCK_MINUTES);
    expect(blockMinutesForTask(15)).toBe(15);
    expect(blockMinutesForTask(16)).toBe(16);
  });

  it("rounds fractional minutes", () => {
    expect(blockMinutesForTask(29.6)).toBe(30);
  });

  it("falls back to the default on implausible values", () => {
    expect(blockMinutesForTask(0)).toBe(DEFAULT_TASK_MINUTES);
    expect(blockMinutesForTask(-30)).toBe(DEFAULT_TASK_MINUTES);
    expect(blockMinutesForTask(1441)).toBe(DEFAULT_TASK_MINUTES);
    expect(blockMinutesForTask(Number.NaN)).toBe(DEFAULT_TASK_MINUTES);
    expect(blockMinutesForTask(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TASK_MINUTES);
  });

  it("keeps the day-long ceiling itself", () => {
    expect(blockMinutesForTask(1440)).toBe(1440);
  });
});
