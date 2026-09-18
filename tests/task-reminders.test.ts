import { describe, expect, it } from "vitest";
import {
  normalizeDueTime,
  taskDueLabel,
  taskReminderAt,
} from "@/lib/domain/task-reminders";

// New York is UTC-4 in September (EDT).
const TZ = "America/New_York";
const at = (iso: string) => new Date(iso);

describe("taskReminderAt — timed tasks", () => {
  it("fires 30 minutes before the due timestamp in the user's timezone", () => {
    // Due 14:30 New York = 18:30Z; reminder 14:00 New York = 18:00Z.
    const r = taskReminderAt(
      { due_date: "2026-09-18", due_time: "14:30:00" },
      TZ,
      at("2026-09-18T10:00:00-04:00"),
    );
    expect(r?.toISOString()).toBe("2026-09-18T18:00:00.000Z");
  });

  it("handles a local evening deadline that crosses UTC midnight", () => {
    // Due 21:00 New York on the 18th = 01:00Z on the 19th.
    const r = taskReminderAt(
      { due_date: "2026-09-18", due_time: "21:00" },
      TZ,
      at("2026-09-18T12:00:00-04:00"),
    );
    expect(r?.toISOString()).toBe("2026-09-19T00:30:00.000Z");
  });

  it("fires now when the reminder moment has passed but the deadline is ahead", () => {
    const now = at("2026-09-18T14:15:00-04:00"); // 15 minutes before a 14:30 deadline
    const r = taskReminderAt({ due_date: "2026-09-18", due_time: "14:30" }, TZ, now);
    expect(r?.getTime()).toBe(now.getTime());
  });

  it("returns null once the deadline itself is past", () => {
    const r = taskReminderAt(
      { due_date: "2026-09-18", due_time: "09:00" },
      TZ,
      at("2026-09-18T10:00:00-04:00"),
    );
    expect(r).toBeNull();
  });
});

describe("taskReminderAt — day tasks (no due_time)", () => {
  it("fires at 10:00 local the day before the due date", () => {
    // 10:00 New York on the 19th = 14:00Z.
    const r = taskReminderAt(
      { due_date: "2026-09-20", due_time: null },
      TZ,
      at("2026-09-18T08:00:00-04:00"),
    );
    expect(r?.toISOString()).toBe("2026-09-19T14:00:00.000Z");
  });

  it("fires now on the due day itself (reminder missed, day not over)", () => {
    const now = at("2026-09-18T12:00:00-04:00"); // due today, 10:00-yesterday slot long gone
    const r = taskReminderAt({ due_date: "2026-09-18", due_time: null }, TZ, now);
    expect(r?.getTime()).toBe(now.getTime());
  });

  it("returns null once the due day has ended locally", () => {
    // 00:30 New York on the 19th: the 18th is over in New York even though
    // it is still 04:30Z — a UTC-based check would get this wrong.
    const r = taskReminderAt(
      { due_date: "2026-09-18", due_time: null },
      TZ,
      at("2026-09-19T00:30:00-04:00"),
    );
    expect(r).toBeNull();
  });

  it("still counts the due day as alive just before local midnight", () => {
    const now = at("2026-09-18T23:30:00-04:00");
    const r = taskReminderAt({ due_date: "2026-09-18", due_time: null }, TZ, now);
    expect(r?.getTime()).toBe(now.getTime());
  });
});

describe("taskReminderAt — bad data", () => {
  it("treats an unparseable due_time as a day task", () => {
    const r = taskReminderAt(
      { due_date: "2026-09-20", due_time: "sometime" },
      TZ,
      at("2026-09-18T08:00:00-04:00"),
    );
    expect(r?.toISOString()).toBe("2026-09-19T14:00:00.000Z");
  });

  it("returns null for an unparseable due_date", () => {
    expect(taskReminderAt({ due_date: "soon", due_time: null }, TZ, at("2026-09-18T08:00:00Z"))).toBeNull();
  });
});

describe("normalizeDueTime", () => {
  it("trims Postgres seconds and rejects junk", () => {
    expect(normalizeDueTime("14:30:00")).toBe("14:30");
    expect(normalizeDueTime("09:05")).toBe("09:05");
    expect(normalizeDueTime("25:00")).toBeNull();
    expect(normalizeDueTime(null)).toBeNull();
  });
});

describe("taskDueLabel", () => {
  it("uses the local time for timed tasks", () => {
    expect(taskDueLabel({ due_date: "2026-09-18", due_time: "14:30:00" }, "2026-09-18")).toBe(
      "Due 14:30",
    );
  });

  it("says today / tomorrow / the date for day tasks", () => {
    expect(taskDueLabel({ due_date: "2026-09-18", due_time: null }, "2026-09-18")).toBe("Due today");
    expect(taskDueLabel({ due_date: "2026-09-19", due_time: null }, "2026-09-18")).toBe(
      "Due tomorrow",
    );
    expect(taskDueLabel({ due_date: "2026-09-25", due_time: null }, "2026-09-18")).toBe(
      "Due 2026-09-25",
    );
  });
});

describe("snoozeRoutineId", () => {
  it("keys on the task and the UTC hour of the snoozed fire time", () => {
    const id = "3f8a1b2c-0000-4000-8000-000000000001";
    expect(snoozeRoutineId(id, at("2026-09-18T18:40:00Z"))).toBe(`task_due:${id}:snooze:18`);
  });

  it("never collides with schedule-day's plain task_due key for the same task", () => {
    const id = "3f8a1b2c-0000-4000-8000-000000000001";
    expect(snoozeRoutineId(id, at("2026-09-18T18:40:00Z"))).not.toBe(`task_due:${id}`);
  });
});
