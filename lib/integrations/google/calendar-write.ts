import "server-only";
import { google, type Auth, type calendar_v3 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { createServiceClient, singleUserId } from "@/lib/supabase/service";
import { getSettings } from "@/lib/settings";
import { serverEnv } from "@/lib/env";
import { listAccounts } from "@/lib/integrations/accounts";
import { errorStatus, getGoogleClientForAccount } from "@/lib/integrations/google/client";
import type { CalendarEvent, ConnectedAccount, Routine, Task } from "@/lib/types";

/**
 * The ONLY module in the app that writes to Google Calendar (SPEC §6.1).
 *
 * Two hard rules from CLAUDE.md §4, enforced here:
 *   1. Writes only ever go to account.writable_calendar_id.
 *   2. The app never modifies an event it did not create — every patch and
 *      delete is gated on calendar_events.created_by_app = true.
 *
 * Completing a task appends " ✓" to the event title; it never deletes the
 * event, so the calendar stays an honest record of the day.
 */

const DEFAULT_TASK_MINUTES = 60;
const ROUTINE_MINUTES = 30;
const DONE_MARK = " ✓";

export class NoWritableCalendarError extends Error {
  constructor() {
    super("No writable calendar configured");
    this.name = "NoWritableCalendarError";
  }
}

interface Ctx {
  supabase: SupabaseClient;
  userId: string;
  timezone: string;
}

async function ctx(): Promise<Ctx> {
  const supabase = createServiceClient();
  const userId = await singleUserId(supabase);
  const settings = await getSettings(supabase, userId);
  return { supabase, userId, timezone: settings.timezone || serverEnv().APP_TIMEZONE };
}

/** The account whose designated calendar should hold this task's block. */
async function pickWritableAccount(
  supabase: SupabaseClient,
  userId: string,
  domainId: string | null,
): Promise<ConnectedAccount> {
  const accounts = (await listAccounts(supabase, userId, "google", true)).filter(
    (a) => a.writable_calendar_id,
  );
  if (!accounts.length) throw new NoWritableCalendarError();
  return accounts.find((a) => a.default_domain_id && a.default_domain_id === domainId) ?? accounts[0]!;
}

/** "Block time" on a task (SPEC §6.1 calendar write, use (a)). */
export async function blockTimeForTask(
  taskId: string,
): Promise<{ calendarEventId: string; startsAt: string; htmlLink: string | null }> {
  const { supabase, userId, timezone } = await ctx();
  const task = await loadTask(supabase, taskId);

  if (task.calendar_event_id) {
    const existing = await loadEventRow(supabase, task.calendar_event_id);
    if (existing) {
      await syncTaskCalendarEvent(taskId);
      return {
        calendarEventId: existing.id,
        startsAt: existing.starts_at,
        htmlLink: existing.html_link,
      };
    }
  }

  const account = await pickWritableAccount(supabase, userId, task.domain_id);
  const auth = await getGoogleClientForAccount(supabase, account);
  const cal = google.calendar({ version: "v3", auth });
  const calendarId = account.writable_calendar_id as string;

  const start = await chooseStart(cal, account, task, timezone);
  const end = new Date(start.getTime() + DEFAULT_TASK_MINUTES * 60_000);

  const { data: created } = await cal.events.insert({
    calendarId,
    requestBody: {
      summary: task.status === "done" ? `${task.title}${DONE_MARK}` : task.title,
      description: `Blocked from LifeOS.\n${appUrl()}/tasks?task=${task.id}`,
      start: { dateTime: start.toISOString(), timeZone: timezone },
      end: { dateTime: end.toISOString(), timeZone: timezone },
      extendedProperties: { private: { lifeos_task_id: task.id } },
    },
  });
  if (!created?.id) throw new Error("Google did not return an event id");

  const { data: row, error } = await supabase
    .from("calendar_events")
    .insert({
      user_id: userId,
      account_id: account.id,
      calendar_id: calendarId,
      external_id: created.id,
      title: created.summary ?? task.title,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      all_day: false,
      attendees: [],
      location: created.location ?? null,
      html_link: created.htmlLink ?? null,
      task_id: task.id,
      created_by_app: true,
      status: created.status ?? "confirmed",
    })
    .select("id, starts_at, html_link")
    .single();
  if (error || !row) throw new Error(`block time: ${error?.message ?? "insert failed"}`);

  await supabase.from("tasks").update({ calendar_event_id: row.id }).eq("id", task.id);

  return {
    calendarEventId: row.id as string,
    startsAt: row.starts_at as string,
    htmlLink: (row.html_link as string | null) ?? null,
  };
}

/**
 * Keep an app-created block in step with its task. A1 calls this after any
 * reschedule or completion. Safe to call for tasks with no block.
 */
export async function syncTaskCalendarEvent(taskId: string): Promise<void> {
  const { supabase, timezone } = await ctx();
  const task = await loadTask(supabase, taskId);
  if (!task.calendar_event_id) return;

  const row = await loadEventRow(supabase, task.calendar_event_id);
  if (!row) {
    await supabase.from("tasks").update({ calendar_event_id: null }).eq("id", task.id);
    return;
  }
  if (!row.created_by_app) return; // never touch what we did not create

  if (task.status === "dropped") {
    await removeTaskCalendarEvent(taskId);
    return;
  }

  const account = await accountFor(supabase, row.account_id);
  if (!account) return;
  const auth = await getGoogleClientForAccount(supabase, account);
  const cal = google.calendar({ version: "v3", auth });

  const title = task.status === "done" ? `${stripDone(task.title)}${DONE_MARK}` : stripDone(task.title);
  const body: calendar_v3.Schema$Event = { summary: title };

  // Done keeps its time (the block is a record of when it happened); an open
  // task follows its due/scheduled date.
  let startsAt = row.starts_at;
  let endsAt = row.ends_at;
  if (task.status !== "done") {
    const desired = explicitStart(task, timezone);
    if (desired) {
      const duration = Date.parse(row.ends_at) - Date.parse(row.starts_at) || DEFAULT_TASK_MINUTES * 60_000;
      startsAt = desired.toISOString();
      endsAt = new Date(desired.getTime() + duration).toISOString();
      body.start = { dateTime: startsAt, timeZone: timezone };
      body.end = { dateTime: endsAt, timeZone: timezone };
    }
  }

  try {
    await cal.events.patch({
      calendarId: row.calendar_id,
      eventId: row.external_id,
      requestBody: body,
    });
  } catch (err) {
    if (errorStatus(err) === 404 || errorStatus(err) === 410) {
      await supabase.from("calendar_events").delete().eq("id", row.id);
      await supabase.from("tasks").update({ calendar_event_id: null }).eq("id", task.id);
      return;
    }
    throw err;
  }

  await supabase
    .from("calendar_events")
    .update({ title, starts_at: startsAt, ends_at: endsAt })
    .eq("id", row.id);
}

/**
 * Deleting (or dropping) a task removes the app-created event. Call this
 * BEFORE deleting the task row — it reads the task to find the event.
 */
export async function removeTaskCalendarEvent(taskId: string): Promise<void> {
  const { supabase } = await ctx();
  const { data: task } = await supabase
    .from("tasks")
    .select("id, calendar_event_id")
    .eq("id", taskId)
    .maybeSingle();
  const eventId = (task?.calendar_event_id as string | null) ?? null;
  if (!eventId) return;

  const row = await loadEventRow(supabase, eventId);
  if (!row) return;
  if (!row.created_by_app) return;

  const account = await accountFor(supabase, row.account_id);
  if (account) {
    try {
      const auth = await getGoogleClientForAccount(supabase, account);
      await google
        .calendar({ version: "v3", auth })
        .events.delete({ calendarId: row.calendar_id, eventId: row.external_id });
    } catch (err) {
      const status = errorStatus(err);
      if (status !== 404 && status !== 410) throw err;
    }
  }
  await supabase.from("calendar_events").delete().eq("id", row.id);
  await supabase.from("tasks").update({ calendar_event_id: null }).eq("id", taskId);
}

/**
 * Routines with write_to_calendar get one recurring event (SPEC §6.1 use (b)).
 * Created once; routines.calendar_event_external_id records it.
 */
export async function syncRoutineCalendarEvent(routineId: string): Promise<void> {
  const { supabase, userId, timezone } = await ctx();
  const { data } = await supabase.from("routines").select("*").eq("id", routineId).maybeSingle();
  const routine = data as Routine | null;
  if (!routine) return;

  const account = await pickWritableAccount(supabase, userId, routine.domain_id);
  const auth = await getGoogleClientForAccount(supabase, account);
  const cal = google.calendar({ version: "v3", auth });
  const calendarId = account.writable_calendar_id as string;

  // Turned off (or deactivated): remove the recurring event we made.
  if (!routine.write_to_calendar || !routine.active) {
    if (routine.calendar_event_external_id) {
      try {
        await cal.events.delete({ calendarId, eventId: routine.calendar_event_external_id });
      } catch (err) {
        const status = errorStatus(err);
        if (status !== 404 && status !== 410) throw err;
      }
      await supabase
        .from("calendar_events")
        .delete()
        .eq("account_id", account.id)
        .eq("calendar_id", calendarId)
        .eq("external_id", routine.calendar_event_external_id);
      await supabase.from("routines").update({ calendar_event_external_id: null }).eq("id", routine.id);
    }
    return;
  }

  const time = (routine.reminder_time ?? "08:00").slice(0, 5);
  const days = routine.schedule_days.length ? routine.schedule_days : [0, 1, 2, 3, 4, 5, 6];
  const byDay = days.map((d) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][d] ?? "MO").join(",");
  const rrule = `RRULE:FREQ=WEEKLY;BYDAY=${byDay}`;

  const firstDate = nextDateForDays(days, timezone);
  const start = fromZonedTime(`${firstDate}T${time}:00`, timezone);
  const end = new Date(start.getTime() + ROUTINE_MINUTES * 60_000);

  const requestBody: calendar_v3.Schema$Event = {
    summary: routine.emoji ? `${routine.emoji} ${routine.name}` : routine.name,
    description: `LifeOS routine.\n${appUrl()}/routines`,
    start: { dateTime: start.toISOString(), timeZone: timezone },
    end: { dateTime: end.toISOString(), timeZone: timezone },
    recurrence: [rrule],
    extendedProperties: { private: { lifeos_routine_id: routine.id } },
  };

  if (routine.calendar_event_external_id) {
    try {
      await cal.events.patch({
        calendarId,
        eventId: routine.calendar_event_external_id,
        requestBody,
      });
      return;
    } catch (err) {
      const status = errorStatus(err);
      if (status !== 404 && status !== 410) throw err;
      // fall through and recreate
    }
  }

  const { data: created } = await cal.events.insert({ calendarId, requestBody });
  if (!created?.id) return;

  await supabase
    .from("routines")
    .update({ calendar_event_external_id: created.id })
    .eq("id", routine.id);

  await supabase.from("calendar_events").insert({
    user_id: userId,
    account_id: account.id,
    calendar_id: calendarId,
    external_id: created.id,
    title: requestBody.summary ?? routine.name,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    all_day: false,
    attendees: [],
    html_link: created.htmlLink ?? null,
    routine_id: routine.id,
    created_by_app: true,
    status: created.status ?? "confirmed",
  });
}

// ---------------------------------------------------------------------------
// timing helpers
// ---------------------------------------------------------------------------

/** The time the task itself dictates, if any. */
function explicitStart(task: Task, timezone: string): Date | null {
  const date = task.due_date ?? task.scheduled_date;
  if (!date) return null;
  const time = (task.due_time ?? "09:00").slice(0, 5);
  return fromZonedTime(`${date}T${time}:00`, timezone);
}

/**
 * Where to put a new block: the task's own time if it has one, otherwise the
 * next free hour today, otherwise tomorrow morning (SPEC: "1h default at the
 * next free slot").
 */
async function chooseStart(
  cal: calendar_v3.Calendar,
  account: ConnectedAccount,
  task: Task,
  timezone: string,
): Promise<Date> {
  if (task.due_date && task.due_time) return explicitStart(task, timezone) as Date;

  const now = new Date();
  const anchorDate = task.due_date ?? task.scheduled_date ?? formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const tomorrow = formatInTimeZone(new Date(Date.now() + 86_400_000), timezone, "yyyy-MM-dd");

  const windows = [
    {
      start: maxDate(fromZonedTime(`${anchorDate}T08:00:00`, timezone), roundUp(now)),
      end: fromZonedTime(`${anchorDate}T18:00:00`, timezone),
    },
    {
      start: fromZonedTime(`${tomorrow}T08:00:00`, timezone),
      end: fromZonedTime(`${tomorrow}T12:00:00`, timezone),
    },
  ].filter((w) => w.end.getTime() - w.start.getTime() >= DEFAULT_TASK_MINUTES * 60_000);

  const busy = await busyPeriods(cal, account, windows[0]?.start ?? now, windows.at(-1)?.end ?? now);
  for (const w of windows) {
    const slot = firstGap(busy, w.start, w.end, DEFAULT_TASK_MINUTES * 60_000);
    if (slot) return slot;
  }
  return explicitStart(task, timezone) ?? fromZonedTime(`${tomorrow}T09:00:00`, timezone);
}

async function busyPeriods(
  cal: calendar_v3.Calendar,
  account: ConnectedAccount,
  timeMin: Date,
  timeMax: Date,
): Promise<Array<{ start: number; end: number }>> {
  const ids = new Set<string>([...(account.read_calendar_ids ?? [])]);
  if (account.writable_calendar_id) ids.add(account.writable_calendar_id);
  if (!ids.size) return [];
  try {
    const { data } = await cal.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [...ids].map((id) => ({ id })),
      },
    });
    const out: Array<{ start: number; end: number }> = [];
    for (const cald of Object.values(data.calendars ?? {})) {
      for (const b of cald.busy ?? []) {
        if (b.start && b.end) out.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  } catch {
    return []; // free/busy is a nicety; never block the write on it
  }
}

function firstGap(
  busy: Array<{ start: number; end: number }>,
  windowStart: Date,
  windowEnd: Date,
  durationMs: number,
): Date | null {
  let cursor = windowStart.getTime();
  const limit = windowEnd.getTime();
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start >= limit) break;
    if (b.start - cursor >= durationMs) return new Date(cursor);
    cursor = Math.max(cursor, b.end);
  }
  return limit - cursor >= durationMs ? new Date(cursor) : null;
}

function roundUp(d: Date): Date {
  const ms = 30 * 60_000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function nextDateForDays(days: number[], timezone: string): string {
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 86_400_000);
    const dow = Number(formatInTimeZone(d, timezone, "i")) % 7;
    if (days.includes(dow)) return formatInTimeZone(d, timezone, "yyyy-MM-dd");
  }
  return formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
}

function stripDone(title: string): string {
  return title.replace(/\s*✓\s*$/, "");
}

function appUrl(): string {
  return serverEnv().APP_URL.replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// row helpers
// ---------------------------------------------------------------------------

async function loadTask(supabase: SupabaseClient, taskId: string): Promise<Task> {
  const { data, error } = await supabase.from("tasks").select("*").eq("id", taskId).single();
  if (error || !data) throw new Error(`task ${taskId} not found`);
  return data as Task;
}

async function loadEventRow(supabase: SupabaseClient, id: string): Promise<CalendarEvent | null> {
  const { data } = await supabase.from("calendar_events").select("*").eq("id", id).maybeSingle();
  return (data as CalendarEvent | null) ?? null;
}

async function accountFor(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ConnectedAccount | null> {
  const { data } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();
  return (data as ConnectedAccount | null) ?? null;
}
