import { describe, expect, it } from "vitest";
import {
  assembleScorecardInput,
  computeScorecard,
  summarizeScorecard,
  UNASSIGNED_DOMAIN_KEY,
  type ScorecardInput,
  type ScorecardRawRows,
} from "@/lib/domain/scorecard";

// Week of Mon 2026-09-07 to Sun 2026-09-13, scored on the Sunday.
const WEEK_START = "2026-09-07";
const WEEK_END = "2026-09-13";
const PERSONAL = "domain-personal";
const TARIFA = "domain-tarifa";

function input(overrides: Partial<ScorecardInput> = {}): ScorecardInput {
  return {
    week_start: WEEK_START,
    week_end: WEEK_END,
    as_of: WEEK_END,
    timezone: "America/New_York",
    domain_ids: [PERSONAL, TARIFA],
    tasks: [],
    suggestions: [],
    routines: [],
    captures: [],
    calendar_events: [],
    people_overdue_followup: 0,
    previous_weeks: [],
    ...overrides,
  };
}

const baseTask = {
  domain_id: PERSONAL,
  status: "open" as const,
  origin: "manual" as const,
  created_at: "2026-09-08T14:00:00Z",
  updated_at: "2026-09-08T14:00:00Z",
  completed_at: null,
  due_date: null,
};

describe("computeScorecard — tasks", () => {
  it("returns zeroed domains when nothing happened", () => {
    const card = computeScorecard(input());
    expect(card.week_start).toBe(WEEK_START);
    expect(card.domains[PERSONAL]).toEqual({
      created: 0,
      completed: 0,
      dropped: 0,
      open: 0,
      overdue_at_week_end: 0,
    });
    expect(card.total).toEqual({ created: 0, completed: 0, dropped: 0, open: 0, overdue_at_week_end: 0 });
  });

  it("counts created, completed, dropped and open per domain and in total", () => {
    const card = computeScorecard(
      input({
        tasks: [
          { ...baseTask },
          { ...baseTask, status: "done", completed_at: "2026-09-09T15:00:00Z" },
          { ...baseTask, status: "dropped", updated_at: "2026-09-10T15:00:00Z" },
          { ...baseTask, domain_id: TARIFA, status: "done", completed_at: "2026-09-11T15:00:00Z" },
          // created before the week, completed in it
          {
            ...baseTask,
            domain_id: TARIFA,
            created_at: "2026-08-30T12:00:00Z",
            status: "done",
            completed_at: "2026-09-12T15:00:00Z",
          },
          // created after the week: ignored entirely
          { ...baseTask, created_at: "2026-09-20T12:00:00Z" },
        ],
      }),
    );
    expect(card.domains[PERSONAL]).toMatchObject({ created: 3, completed: 1, dropped: 1, open: 1 });
    expect(card.domains[TARIFA]).toMatchObject({ created: 1, completed: 2, dropped: 0, open: 0 });
    expect(card.total).toMatchObject({ created: 4, completed: 3, dropped: 1, open: 1 });
  });

  it("counts open tasks whose due date has passed by week end as overdue", () => {
    const card = computeScorecard(
      input({
        tasks: [
          { ...baseTask, due_date: "2026-09-10" },
          { ...baseTask, due_date: WEEK_END },
          { ...baseTask, due_date: "2026-09-20" },
          { ...baseTask, due_date: "2026-09-10", status: "done", completed_at: "2026-09-10T12:00:00Z" },
        ],
      }),
    );
    expect(card.domains[PERSONAL]?.overdue_at_week_end).toBe(2);
    expect(card.total.overdue_at_week_end).toBe(2);
  });

  it("buckets timestamps by the user's timezone, not UTC", () => {
    // 02:00Z on Monday the 14th is still Sunday the 13th in New York.
    const card = computeScorecard(
      input({
        tasks: [
          { ...baseTask, status: "done", completed_at: "2026-09-14T02:00:00Z" },
          // 2026-09-07T02:00Z is Sunday the 6th in New York: previous week.
          { ...baseTask, status: "done", completed_at: "2026-09-07T02:00:00Z" },
        ],
      }),
    );
    expect(card.total.completed).toBe(1);
  });

  it("creates a bucket for a domain that was not listed", () => {
    const card = computeScorecard(input({ tasks: [{ ...baseTask, domain_id: "domain-misc" }] }));
    expect(card.domains["domain-misc"]?.created).toBe(1);
  });
});

describe("computeScorecard — commitments", () => {
  it("splits suggestion-born tasks due this week into on time, late and still open", () => {
    const card = computeScorecard(
      input({
        tasks: [
          {
            ...baseTask,
            origin: "suggestion",
            due_date: "2026-09-10",
            status: "done",
            completed_at: "2026-09-09T15:00:00Z",
          },
          {
            ...baseTask,
            origin: "suggestion",
            due_date: "2026-09-10",
            status: "done",
            completed_at: "2026-09-10T15:00:00Z",
          },
          {
            ...baseTask,
            origin: "suggestion",
            due_date: "2026-09-09",
            status: "done",
            completed_at: "2026-09-12T15:00:00Z",
          },
          { ...baseTask, origin: "suggestion", due_date: "2026-09-11" },
          // out of scope: no due date, wrong origin, due outside the week
          { ...baseTask, origin: "suggestion" },
          { ...baseTask, due_date: "2026-09-11" },
          { ...baseTask, origin: "suggestion", due_date: "2026-09-30" },
        ],
      }),
    );
    expect(card.commitments).toEqual({ on_time: 2, late: 1, still_open: 1 });
  });
});

describe("computeScorecard — routines", () => {
  const gymLogs = [
    { date: "2026-09-07", status: "done" as const },
    { date: "2026-09-09", status: "skipped" as const },
    { date: "2026-09-11", status: "done" as const },
  ];

  it("counts scheduled, done, skipped and missed and computes adherence", () => {
    const card = computeScorecard(
      input({
        routines: [{ id: "r-gym", name: "Gym", schedule_days: [1, 3, 5], logs: gymLogs }],
      }),
    );
    const gym = card.routines[0];
    expect(gym).toMatchObject({
      routine_id: "r-gym",
      name: "Gym",
      scheduled: 3,
      done: 2,
      skipped: 1,
      missed: 0,
    });
    expect(gym?.adherence).toBe(1);
  });

  it("treats a scheduled day in the past with no log as missed", () => {
    const card = computeScorecard(
      input({
        as_of: "2026-09-14",
        routines: [
          {
            id: "r-vitamins",
            name: "Vitamins",
            schedule_days: [0, 1, 2, 3, 4, 5, 6],
            logs: [
              { date: "2026-09-07", status: "done" },
              { date: "2026-09-08", status: "done" },
              { date: "2026-09-09", status: "missed" },
            ],
          },
        ],
      }),
    );
    expect(card.routines[0]).toMatchObject({ scheduled: 7, done: 2, skipped: 0, missed: 5 });
    expect(card.routines[0]?.adherence).toBeCloseTo(2 / 7, 4);
  });

  it("carries the current and best streak", () => {
    const card = computeScorecard(
      input({
        routines: [
          {
            id: "r-gym",
            name: "Gym",
            schedule_days: [1, 3, 5],
            logs: [
              { date: "2026-08-31", status: "done" },
              { date: "2026-09-02", status: "done" },
              { date: "2026-09-04", status: "done" },
              { date: "2026-09-07", status: "done" },
              { date: "2026-09-09", status: "skipped" },
              { date: "2026-09-11", status: "done" },
            ],
          },
        ],
      }),
    );
    expect(card.routines[0]).toMatchObject({ current_streak: 5, best_streak: 5 });
  });

  it("gives an adherence of 0 when nothing was scheduled", () => {
    const card = computeScorecard(
      input({ routines: [{ id: "r-x", name: "X", schedule_days: [], logs: [] }] }),
    );
    expect(card.routines[0]?.adherence).toBe(0);
  });
});

describe("computeScorecard — queue", () => {
  it("counts received, accepted, dismissed and pending at week end", () => {
    const card = computeScorecard(
      input({
        suggestions: [
          { created_at: "2026-09-08T12:00:00Z", status: "accepted", resolved_at: "2026-09-08T18:00:00Z" },
          { created_at: "2026-09-09T12:00:00Z", status: "dismissed", resolved_at: "2026-09-10T12:00:00Z" },
          { created_at: "2026-09-10T12:00:00Z", status: "pending", resolved_at: null },
          { created_at: "2026-09-01T12:00:00Z", status: "pending", resolved_at: null },
          // resolved after the week: pending at week end, not counted as accepted
          { created_at: "2026-09-12T12:00:00Z", status: "accepted", resolved_at: "2026-09-16T12:00:00Z" },
          // created after the week: nothing
          { created_at: "2026-09-20T12:00:00Z", status: "pending", resolved_at: null },
        ],
      }),
    );
    expect(card.queue).toMatchObject({ received: 4, accepted: 1, dismissed: 1, pending_at_week_end: 3 });
  });

  it("takes the median hours to resolve", () => {
    const card = computeScorecard(
      input({
        suggestions: [
          { created_at: "2026-09-08T00:00:00Z", status: "accepted", resolved_at: "2026-09-08T02:00:00Z" },
          { created_at: "2026-09-09T00:00:00Z", status: "accepted", resolved_at: "2026-09-09T06:00:00Z" },
          { created_at: "2026-09-10T00:00:00Z", status: "dismissed", resolved_at: "2026-09-10T10:00:00Z" },
        ],
      }),
    );
    expect(card.queue.median_hours_to_resolve).toBe(6);
  });

  it("averages the two middle values for an even count", () => {
    const card = computeScorecard(
      input({
        suggestions: [
          { created_at: "2026-09-08T00:00:00Z", status: "accepted", resolved_at: "2026-09-08T02:00:00Z" },
          { created_at: "2026-09-09T00:00:00Z", status: "accepted", resolved_at: "2026-09-09T05:00:00Z" },
        ],
      }),
    );
    expect(card.queue.median_hours_to_resolve).toBe(3.5);
  });

  it("is null when nothing was resolved", () => {
    expect(computeScorecard(input()).queue.median_hours_to_resolve).toBeNull();
  });
});

describe("computeScorecard — captures, calendar, people", () => {
  it("counts captures and the ones that needed clarification", () => {
    const card = computeScorecard(
      input({
        captures: [
          { created_at: "2026-09-08T12:00:00Z", result: { items: [] } },
          { created_at: "2026-09-09T12:00:00Z", result: { items: [], needs_clarification: "which project?" } },
          { created_at: "2026-09-09T12:00:00Z", result: null },
          { created_at: "2026-09-30T12:00:00Z", result: { items: [], needs_clarification: "later week" } },
        ],
      }),
    );
    expect(card.captures).toEqual({ count: 3, needed_clarification: 1 });
  });

  it("sums meeting hours by domain and ignores all-day and cancelled events", () => {
    const card = computeScorecard(
      input({
        calendar_events: [
          { starts_at: "2026-09-08T13:00:00Z", ends_at: "2026-09-08T14:00:00Z", all_day: false, domain_id: TARIFA },
          { starts_at: "2026-09-08T15:00:00Z", ends_at: "2026-09-08T15:30:00Z", all_day: false, domain_id: TARIFA },
          { starts_at: "2026-09-09T13:00:00Z", ends_at: "2026-09-09T14:00:00Z", all_day: false, domain_id: null },
          { starts_at: "2026-09-09T13:00:00Z", ends_at: "2026-09-09T23:00:00Z", all_day: true, domain_id: TARIFA },
          {
            starts_at: "2026-09-10T13:00:00Z",
            ends_at: "2026-09-10T18:00:00Z",
            all_day: false,
            domain_id: TARIFA,
            status: "cancelled",
          },
          { starts_at: "2026-09-20T13:00:00Z", ends_at: "2026-09-20T14:00:00Z", all_day: false, domain_id: TARIFA },
        ],
      }),
    );
    expect(card.meeting_hours_by_domain).toEqual({ [TARIFA]: 1.5, [UNASSIGNED_DOMAIN_KEY]: 1 });
  });

  it("passes the overdue follow-up count through", () => {
    expect(computeScorecard(input({ people_overdue_followup: 4 })).people_overdue_followup).toBe(4);
  });
});

describe("computeScorecard — deltas", () => {
  const previous = [
    { week_start: "2026-08-31", completed: 10, on_time_rate: 0.5, adherence: 0.8 },
    { week_start: "2026-08-24", completed: 6, on_time_rate: 1, adherence: 0.6 },
    { week_start: "2026-08-17", completed: 8, on_time_rate: null, adherence: 0.7 },
    { week_start: "2026-08-10", completed: 4, on_time_rate: 0.5, adherence: 0.5 },
    { week_start: "2026-08-03", completed: 99, on_time_rate: 0, adherence: 0 },
  ];

  it("keeps the four most recent previous weeks, newest first", () => {
    const card = computeScorecard(input({ previous_weeks: previous }));
    expect(card.deltas.vs_prev_weeks.map((w) => w.week_start)).toEqual([
      "2026-08-31",
      "2026-08-24",
      "2026-08-17",
      "2026-08-10",
    ]);
    expect(card.deltas.vs_prev_weeks[0]).toEqual(previous[0]);
  });

  it("compares this week's completions with the four-week average", () => {
    const card = computeScorecard(
      input({
        previous_weeks: previous,
        tasks: [{ ...baseTask, status: "done", completed_at: "2026-09-09T15:00:00Z" }],
      }),
    );
    // average of 10, 6, 8, 4 is 7; one completed this week
    expect(card.deltas.vs_4wk_avg.completed).toBe(-6);
  });

  it("compares the on-time rate and adherence, skipping null history", () => {
    const card = computeScorecard(
      input({
        previous_weeks: previous,
        tasks: [
          {
            ...baseTask,
            origin: "suggestion",
            due_date: "2026-09-10",
            status: "done",
            completed_at: "2026-09-09T15:00:00Z",
          },
          { ...baseTask, origin: "suggestion", due_date: "2026-09-11" },
        ],
        routines: [
          {
            id: "r",
            name: "R",
            schedule_days: [1, 3, 5],
            logs: [
              { date: "2026-09-07", status: "done" },
              { date: "2026-09-09", status: "done" },
              { date: "2026-09-11", status: "missed" },
            ],
          },
        ],
      }),
    );
    // on-time rate 1/2 vs an average of (0.5 + 1 + 0.5)/3
    expect(card.deltas.vs_4wk_avg.on_time_rate).toBeCloseTo(0.5 - 2 / 3, 4);
    // adherence 2/3 vs an average of (0.8 + 0.6 + 0.7 + 0.5)/4 = 0.65
    expect(card.deltas.vs_4wk_avg.adherence).toBeCloseTo(2 / 3 - 0.65, 4);
  });

  it("is null when there is no history or nothing to compare", () => {
    const card = computeScorecard(input());
    expect(card.deltas.vs_prev_weeks).toEqual([]);
    expect(card.deltas.vs_4wk_avg).toEqual({ completed: null, on_time_rate: null, adherence: null });
  });

  it("ignores summaries that are not before this week", () => {
    const card = computeScorecard(
      input({ previous_weeks: [{ week_start: "2026-09-14", completed: 50, on_time_rate: 1, adherence: 1 }] }),
    );
    expect(card.deltas.vs_prev_weeks).toEqual([]);
  });
});

describe("summarizeScorecard", () => {
  it("round-trips a computed card into the previous-week shape", () => {
    const card = computeScorecard(
      input({
        tasks: [
          { ...baseTask, status: "done", completed_at: "2026-09-09T15:00:00Z" },
          {
            ...baseTask,
            origin: "suggestion",
            due_date: "2026-09-10",
            status: "done",
            completed_at: "2026-09-09T15:00:00Z",
          },
          { ...baseTask, origin: "suggestion", due_date: "2026-09-11" },
        ],
        routines: [
          {
            id: "r",
            name: "R",
            schedule_days: [1, 3, 5],
            logs: [
              { date: "2026-09-07", status: "done" },
              { date: "2026-09-09", status: "skipped" },
              { date: "2026-09-11", status: "missed" },
            ],
          },
        ],
      }),
    );
    expect(summarizeScorecard(card)).toEqual({
      week_start: WEEK_START,
      completed: 2,
      on_time_rate: 0.5,
      adherence: 0.5,
    });
  });

  it("reports null rates when there is nothing to divide by", () => {
    expect(summarizeScorecard(computeScorecard(input()))).toEqual({
      week_start: WEEK_START,
      completed: 0,
      on_time_rate: null,
      adherence: null,
    });
  });
});

describe("computeScorecard — defaults", () => {
  it("derives week_end from week_start", () => {
    const card = computeScorecard({
      ...input({ week_end: undefined, as_of: undefined }),
      tasks: [{ ...baseTask, status: "done", completed_at: "2026-09-13T15:00:00Z" }],
    });
    expect(card.total.completed).toBe(1);
  });
});

describe("computeScorecard — partial week (card computed mid-week)", () => {
  it("does not count days after as_of as scheduled or missed", () => {
    // Wednesday of the review week: only Mon and Tue have happened.
    const card = computeScorecard(
      input({
        as_of: "2026-09-09",
        routines: [
          {
            id: "r-vitamins",
            name: "Vitamins",
            schedule_days: [0, 1, 2, 3, 4, 5, 6],
            logs: [
              { date: "2026-09-07", status: "done" },
              { date: "2026-09-08", status: "done" },
            ],
          },
        ],
      }),
    );
    // Wed (as_of) has no log yet, so it is pending, not missed.
    expect(card.routines[0]).toMatchObject({ scheduled: 2, done: 2, skipped: 0, missed: 0 });
    expect(card.routines[0]?.adherence).toBe(1);
  });

  it("still counts an unlogged past day of the partial week as missed", () => {
    const card = computeScorecard(
      input({
        as_of: "2026-09-09",
        routines: [
          {
            id: "r-vitamins",
            name: "Vitamins",
            schedule_days: [0, 1, 2, 3, 4, 5, 6],
            logs: [{ date: "2026-09-07", status: "done" }],
          },
        ],
      }),
    );
    expect(card.routines[0]).toMatchObject({ scheduled: 2, done: 1, missed: 1 });
    expect(card.routines[0]?.adherence).toBe(0.5);
  });

  it("counts a day logged done on as_of itself", () => {
    const card = computeScorecard(
      input({
        as_of: "2026-09-09",
        routines: [
          {
            id: "r-vitamins",
            name: "Vitamins",
            schedule_days: [0, 1, 2, 3, 4, 5, 6],
            logs: [
              { date: "2026-09-07", status: "missed" },
              { date: "2026-09-08", status: "skipped" },
              { date: "2026-09-09", status: "done" },
            ],
          },
        ],
      }),
    );
    expect(card.routines[0]).toMatchObject({ scheduled: 3, done: 1, skipped: 1, missed: 1 });
    expect(card.routines[0]?.adherence).toBe(0.5);
  });
});

describe("assembleScorecardInput", () => {
  // The exact first-week shape: a deployment a couple of days old, a review
  // opened on a Wednesday, nothing in any table yet.
  function raw(overrides: Partial<ScorecardRawRows> = {}): ScorecardRawRows {
    return {
      week_start: "2026-09-14",
      week_end: "2026-09-20",
      timezone: "America/New_York",
      // 18:00Z on Wed 2026-09-16 is 14:00 in New York, still the 16th.
      now: "2026-09-16T18:00:00Z",
      domains: [],
      tasks: [],
      suggestions: [],
      routines: [],
      routine_logs: [],
      captures: [],
      calendar_events: [],
      people_overdue_followup: 0,
      previous_scorecards: [],
      ...overrides,
    };
  }

  it("computes an all-zero card from completely empty rows without throwing", () => {
    const card = computeScorecard(assembleScorecardInput(raw()));
    expect(card.total).toEqual({ created: 0, completed: 0, dropped: 0, open: 0, overdue_at_week_end: 0 });
    expect(card.routines).toEqual([]);
    expect(card.queue).toEqual({
      received: 0,
      accepted: 0,
      dismissed: 0,
      pending_at_week_end: 0,
      median_hours_to_resolve: null,
    });
    expect(card.captures).toEqual({ count: 0, needed_clarification: 0 });
    expect(card.meeting_hours_by_domain).toEqual({});
    expect(card.deltas.vs_prev_weeks).toEqual([]);
    expect(card.deltas.vs_4wk_avg).toEqual({ completed: null, on_time_rate: null, adherence: null });
  });

  it("clamps as_of to the local today when the week is still in progress", () => {
    expect(assembleScorecardInput(raw()).as_of).toBe("2026-09-16");
    // A card recomputed after the week keeps as_of at the week's Sunday.
    expect(assembleScorecardInput(raw({ now: "2026-10-01T12:00:00Z" })).as_of).toBe("2026-09-20");
  });

  it("attaches routine logs to their routines and lists every domain", () => {
    const input = assembleScorecardInput(
      raw({
        domains: [{ id: PERSONAL }, { id: TARIFA }],
        routines: [
          { id: "r-gym", name: "Gym", schedule_days: [1, 3, 5] },
          { id: "r-vitamins", name: "Vitamins", schedule_days: [0, 1, 2, 3, 4, 5, 6] },
        ],
        routine_logs: [
          { routine_id: "r-gym", date: "2026-09-14", status: "done" },
          { routine_id: "r-vitamins", date: "2026-09-14", status: "done" },
          { routine_id: "r-vitamins", date: "2026-09-15", status: "skipped" },
        ],
      }),
    );
    expect(input.domain_ids).toEqual([PERSONAL, TARIFA]);
    expect(input.routines.find((r) => r.id === "r-gym")?.logs).toEqual([
      { date: "2026-09-14", status: "done" },
    ]);
    expect(input.routines.find((r) => r.id === "r-vitamins")?.logs).toHaveLength(2);

    const card = computeScorecard(input);
    expect(card.domains[PERSONAL]).toEqual({
      created: 0,
      completed: 0,
      dropped: 0,
      open: 0,
      overdue_at_week_end: 0,
    });
    // Mid-week on Wednesday: gym had Mon only; vitamins Mon done, Tue skipped.
    expect(card.routines.find((r) => r.routine_id === "r-gym")).toMatchObject({
      scheduled: 1,
      done: 1,
      adherence: 1,
    });
    expect(card.routines.find((r) => r.routine_id === "r-vitamins")).toMatchObject({
      scheduled: 2,
      done: 1,
      skipped: 1,
      adherence: 1,
    });
  });

  it("summarizes whole previous scorecards into previous_weeks", () => {
    const previousCard = computeScorecard(
      input({
        tasks: [{ ...baseTask, status: "done", completed_at: "2026-09-09T15:00:00Z" }],
      }),
    );
    const card = computeScorecard(
      assembleScorecardInput(raw({ previous_scorecards: [previousCard] })),
    );
    expect(card.deltas.vs_prev_weeks).toEqual([
      { week_start: WEEK_START, completed: 1, on_time_rate: null, adherence: null },
    ]);
    expect(card.deltas.vs_4wk_avg.completed).toBe(-1);
  });

  it("buckets calendar events without a domain under unassigned", () => {
    const card = computeScorecard(
      assembleScorecardInput(
        raw({
          calendar_events: [
            { starts_at: "2026-09-15T13:00:00Z", ends_at: "2026-09-15T14:00:00Z", all_day: false },
          ],
        }),
      ),
    );
    expect(card.meeting_hours_by_domain).toEqual({ [UNASSIGNED_DOMAIN_KEY]: 1 });
  });
});
