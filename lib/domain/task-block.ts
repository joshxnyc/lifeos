// How long a calendar block for a task should be (SPEC §6.1). Pure so it can
// be tested without the server-only calendar-write module.

export const DEFAULT_TASK_MINUTES = 60;
/** Anything shorter disappears visually on a calendar and invites overruns. */
export const MIN_BLOCK_MINUTES = 15;

/**
 * The task's own estimate when it has a plausible one, floored at 15 minutes,
 * else the one-hour default. The column CHECK caps estimates at 1440, but the
 * value is re-validated here because this also sees rows written before the
 * constraint existed.
 */
export function blockMinutesForTask(durationMinutes: number | null | undefined): number {
  if (typeof durationMinutes !== "number" || !Number.isFinite(durationMinutes)) {
    return DEFAULT_TASK_MINUTES;
  }
  const minutes = Math.round(durationMinutes);
  if (minutes < 1 || minutes > 1440) return DEFAULT_TASK_MINUTES;
  return Math.max(MIN_BLOCK_MINUTES, minutes);
}
