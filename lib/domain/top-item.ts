// Top-item heuristic (SPEC §7.3). plan-morning scores every open task here,
// hands the top 5 to the LLM, and the LLM picks one given the day's calendar
// load. Keeping the scoring pure and testable is the point: the LLM only ever
// chooses between candidates this function already justified.

import type { Task } from "@/lib/types";
import { diffDays } from "@/lib/domain/dates";

export interface TopItemContext {
  /** YYYY-MM-DD local. */
  today: string;
  /** Last date counted as "this week" (inclusive), usually the coming Sunday. */
  weekEnd: string;
  /** Completed task count per domain id over the last 7 days. Include zeroes. */
  domainCompletions7d: Record<string, number>;
  /** People whose follow-up cadence has lapsed. */
  overdueFollowUpPersonIds: Set<string>;
  /** project_id → target_date (null for areas and undated projects). */
  projectTargetDates: Record<string, string | null>;
}

export interface ScoreBreakdown {
  due: number;
  priority: number;
  scheduled: number;
  followUp: number;
  projectTarget: number;
  domainBalance: number;
  total: number;
}

const OVERDUE_BASE = 50;
const OVERDUE_PER_DAY = 5;
const OVERDUE_CAP = 100;

function dueScore(task: Task, ctx: TopItemContext): number {
  const due = task.due_date;
  if (!due) return 0;
  const days = diffDays(ctx.today, due);
  if (days < 0) return Math.min(OVERDUE_BASE + OVERDUE_PER_DAY * -days, OVERDUE_CAP);
  if (days === 0) return 40;
  if (days === 1) return 20;
  return due <= ctx.weekEnd ? 10 : 0; // only the highest applicable bucket counts
}

function domainBalanceScore(task: Task, ctx: TopItemContext): number {
  const counts = Object.values(ctx.domainCompletions7d);
  const min = counts.length ? Math.min(...counts) : 0;
  const mine = ctx.domainCompletions7d[task.domain_id] ?? 0;
  return mine <= min ? 5 : 0;
}

export function scoreTaskDetailed(task: Task, ctx: TopItemContext): ScoreBreakdown {
  const targetDate = task.project_id ? ctx.projectTargetDates[task.project_id] ?? null : null;
  const breakdown: ScoreBreakdown = {
    due: dueScore(task, ctx),
    priority: task.priority * 8,
    scheduled: task.scheduled_date === ctx.today ? 30 : 0,
    followUp: task.person_id && ctx.overdueFollowUpPersonIds.has(task.person_id) ? 15 : 0,
    // A target date already past is more pressure, not less, so it stays in.
    projectTarget: targetDate && diffDays(ctx.today, targetDate) <= 7 ? 10 : 0,
    domainBalance: domainBalanceScore(task, ctx),
    total: 0,
  };
  breakdown.total =
    breakdown.due +
    breakdown.priority +
    breakdown.scheduled +
    breakdown.followUp +
    breakdown.projectTarget +
    breakdown.domainBalance;
  return breakdown;
}

export function scoreTask(task: Task, ctx: TopItemContext): number {
  return scoreTaskDetailed(task, ctx).total;
}

/**
 * Open tasks sorted by score, highest first. Ties break on the earlier due
 * date, then higher priority, then sort_order, then id, so the ranking is
 * stable across runs. Consumers slice the top 5.
 */
export function rankTasks(tasks: Task[], ctx: TopItemContext): Task[] {
  return tasks
    .filter((t) => t.status === "open")
    .map((task) => ({ task, score: scoreTask(task, ctx) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const dueA = a.task.due_date ?? "9999-12-31";
      const dueB = b.task.due_date ?? "9999-12-31";
      if (dueA !== dueB) return dueA < dueB ? -1 : 1;
      if (b.task.priority !== a.task.priority) return b.task.priority - a.task.priority;
      if (a.task.sort_order !== b.task.sort_order) return a.task.sort_order - b.task.sort_order;
      return a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0;
    })
    .map((entry) => entry.task);
}
