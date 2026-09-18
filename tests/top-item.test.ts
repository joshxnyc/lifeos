import { describe, expect, it } from "vitest";
import { rankTasks, scoreTask, scoreTaskDetailed, type TopItemContext } from "@/lib/domain/top-item";
import { makeTask } from "./helpers";

// Two domains with different completion counts so the balance nudge can be
// isolated: tasks in domain-personal never get it, domain-tarifa always does.
const ctx: TopItemContext = {
  today: "2026-09-15",
  weekEnd: "2026-09-20",
  domainCompletions7d: { "domain-personal": 6, "domain-tarifa": 1 },
  overdueFollowUpPersonIds: new Set(["person-overdue"]),
  projectTargetDates: {
    "project-soon": "2026-09-18",
    "project-today": "2026-09-15",
    "project-past": "2026-09-01",
    "project-far": "2026-11-01",
    "area-ongoing": null,
  },
};

describe("scoreTask — due buckets", () => {
  it("scores an undated task at zero for the due component", () => {
    expect(scoreTaskDetailed(makeTask(), ctx).due).toBe(0);
  });

  it("scores due today at 40", () => {
    expect(scoreTaskDetailed(makeTask({ due_date: "2026-09-15" }), ctx).due).toBe(40);
  });

  it("scores due tomorrow at 20", () => {
    expect(scoreTaskDetailed(makeTask({ due_date: "2026-09-16" }), ctx).due).toBe(20);
  });

  it("scores due later this week at 10", () => {
    expect(scoreTaskDetailed(makeTask({ due_date: "2026-09-17" }), ctx).due).toBe(10);
    expect(scoreTaskDetailed(makeTask({ due_date: "2026-09-20" }), ctx).due).toBe(10);
  });

  it("scores due after this week at 0", () => {
    expect(scoreTaskDetailed(makeTask({ due_date: "2026-09-21" }), ctx).due).toBe(0);
  });

  it("scores overdue at 50 plus 5 a day", () => {
    expect(scoreTaskDetailed(makeTask({ due_date: "2026-09-14" }), ctx).due).toBe(55);
    expect(scoreTaskDetailed(makeTask({ due_date: "2026-09-05" }), ctx).due).toBe(100);
  });

  it("caps the overdue component at 100", () => {
    expect(scoreTaskDetailed(makeTask({ due_date: "2026-08-15" }), ctx).due).toBe(100);
    expect(scoreTaskDetailed(makeTask({ due_date: "2025-01-01" }), ctx).due).toBe(100);
  });

  it("uses only the highest applicable due bucket", () => {
    // Due today must not also collect the "this week" ten points.
    expect(scoreTaskDetailed(makeTask({ due_date: "2026-09-15" }), ctx).due).toBe(40);
  });
});

describe("scoreTask — other components", () => {
  it("adds priority times eight", () => {
    expect(scoreTaskDetailed(makeTask({ priority: 0 }), ctx).priority).toBe(0);
    expect(scoreTaskDetailed(makeTask({ priority: 1 }), ctx).priority).toBe(8);
    expect(scoreTaskDetailed(makeTask({ priority: 2 }), ctx).priority).toBe(16);
    expect(scoreTaskDetailed(makeTask({ priority: 3 }), ctx).priority).toBe(24);
  });

  it("adds 30 when scheduled for today", () => {
    expect(scoreTaskDetailed(makeTask({ scheduled_date: "2026-09-15" }), ctx).scheduled).toBe(30);
    expect(scoreTaskDetailed(makeTask({ scheduled_date: "2026-09-16" }), ctx).scheduled).toBe(0);
  });

  it("adds 15 for a person with an overdue follow-up", () => {
    expect(scoreTaskDetailed(makeTask({ person_id: "person-overdue" }), ctx).followUp).toBe(15);
    expect(scoreTaskDetailed(makeTask({ person_id: "person-fine" }), ctx).followUp).toBe(0);
    expect(scoreTaskDetailed(makeTask(), ctx).followUp).toBe(0);
  });

  it("adds 10 when the project target date is within seven days", () => {
    expect(scoreTaskDetailed(makeTask({ project_id: "project-soon" }), ctx).projectTarget).toBe(10);
    expect(scoreTaskDetailed(makeTask({ project_id: "project-today" }), ctx).projectTarget).toBe(10);
    expect(scoreTaskDetailed(makeTask({ project_id: "project-past" }), ctx).projectTarget).toBe(10);
    expect(scoreTaskDetailed(makeTask({ project_id: "project-far" }), ctx).projectTarget).toBe(0);
    expect(scoreTaskDetailed(makeTask({ project_id: "area-ongoing" }), ctx).projectTarget).toBe(0);
    expect(scoreTaskDetailed(makeTask({ project_id: "project-unknown" }), ctx).projectTarget).toBe(0);
    expect(scoreTaskDetailed(makeTask(), ctx).projectTarget).toBe(0);
  });

  it("adds 5 to the least-completed domain of the last seven days", () => {
    expect(scoreTaskDetailed(makeTask({ domain_id: "domain-tarifa" }), ctx).domainBalance).toBe(5);
    expect(scoreTaskDetailed(makeTask({ domain_id: "domain-personal" }), ctx).domainBalance).toBe(0);
  });

  it("treats a domain missing from the counts as having completed nothing", () => {
    expect(scoreTaskDetailed(makeTask({ domain_id: "domain-misc" }), ctx).domainBalance).toBe(5);
  });

  it("gives every tied domain the nudge", () => {
    const tied: TopItemContext = { ...ctx, domainCompletions7d: { a: 2, b: 2 } };
    expect(scoreTaskDetailed(makeTask({ domain_id: "a" }), tied).domainBalance).toBe(5);
    expect(scoreTaskDetailed(makeTask({ domain_id: "b" }), tied).domainBalance).toBe(5);
  });
});

describe("scoreTask — totals", () => {
  it("sums every component", () => {
    const task = makeTask({
      domain_id: "domain-tarifa",
      due_date: "2026-09-13", // 2 days overdue -> 60
      priority: 3, // 24
      scheduled_date: "2026-09-15", // 30
      person_id: "person-overdue", // 15
      project_id: "project-soon", // 10
    });
    // 60 + 24 + 30 + 15 + 10 + 5 balance
    expect(scoreTask(task, ctx)).toBe(144);
  });

  it("scores a bare undated task in a busy domain at zero", () => {
    expect(scoreTask(makeTask({ domain_id: "domain-personal" }), ctx)).toBe(0);
  });
});

describe("rankTasks", () => {
  it("sorts by score, highest first", () => {
    const overdue = makeTask({ id: "overdue", due_date: "2026-09-10" });
    const today = makeTask({ id: "today", due_date: "2026-09-15" });
    const someday = makeTask({ id: "someday" });
    expect(rankTasks([someday, today, overdue], ctx).map((t) => t.id)).toEqual(["overdue", "today", "someday"]);
  });

  it("drops tasks that are not open", () => {
    const open = makeTask({ id: "open" });
    const done = makeTask({ id: "done", status: "done", due_date: "2026-09-01" });
    const dropped = makeTask({ id: "dropped", status: "dropped", due_date: "2026-09-01" });
    expect(rankTasks([done, dropped, open], ctx).map((t) => t.id)).toEqual(["open"]);
  });

  it("breaks ties on due date, then priority, then sort order, then id", () => {
    const a = makeTask({ id: "a", due_date: "2026-09-16", sort_order: 2 });
    const b = makeTask({ id: "b", due_date: "2026-09-16", sort_order: 1 });
    const c = makeTask({ id: "c", scheduled_date: "2026-09-15", priority: 0 });
    // a and b both score 20; c scores 30 and leads.
    expect(rankTasks([a, b, c], ctx).map((t) => t.id)).toEqual(["c", "b", "a"]);
  });

  it("is stable enough to slice the top five", () => {
    const tasks = Array.from({ length: 8 }, (_, i) =>
      makeTask({ id: `t${i}`, priority: (i % 4) as 0 | 1 | 2 | 3, due_date: "2026-09-15" }),
    );
    const first = rankTasks(tasks, ctx).slice(0, 5).map((t) => t.id);
    const second = rankTasks([...tasks].reverse(), ctx).slice(0, 5).map((t) => t.id);
    expect(first).toEqual(second);
  });

  it("returns an empty list for no tasks", () => {
    expect(rankTasks([], ctx)).toEqual([]);
  });
});
