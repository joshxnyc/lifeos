// Dormancy (SPEC §7.5 / weekly review step 3): a project or person with no
// activity for `dormancy_days` (default 14) is surfaced for a forced decision —
// revive, park or close.

/** Whole days between an ISO timestamp and `now`; negative for future stamps. */
export function daysSinceActivity(lastActivityAt: string, now: Date): number {
  const then = Date.parse(lastActivityAt);
  if (Number.isNaN(then)) return 0;
  return (now.getTime() - then) / 86_400_000;
}

export function isDormant(lastActivityAt: string, dormancyDays: number, now: Date): boolean {
  const then = Date.parse(lastActivityAt);
  // An unparseable stamp is treated as active: never nag on bad data.
  if (Number.isNaN(then)) return false;
  return daysSinceActivity(lastActivityAt, now) >= dormancyDays;
}
