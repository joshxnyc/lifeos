"use server";

// Routine mutations (SPEC §4.2). Every export here is a server action, so the
// module carries "use server" and exports async functions only.
//
// Logging a routine also cancels the pushes that exist purely to chase it:
// the missed nudge (SPEC §8) and the reminder, which is noise once the thing
// is done. notifications-tick re-checks the same condition as a backstop.

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { addDays } from "@/lib/time";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "expected HH:mm")
  .transform((v) => v.slice(0, 5));

const logInput = z.object({
  routineId: uuid,
  date: isoDate,
  status: z.enum(["done", "skipped"]),
});

const routineInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  emoji: z.string().trim().max(8).optional().nullable(),
  schedule_days: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day"),
  reminder_time: hhmm.optional().nullable(),
  grace_minutes: z.coerce.number().int().min(5).max(1440).default(120),
  nudge_enabled: z.boolean().default(true),
  domain_id: uuid.optional().nullable(),
  write_to_calendar: z.boolean().default(false),
  active: z.boolean().default(true),
});

export type RoutineInput = z.input<typeof routineInput>;

async function requireUser(supabase: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

function revalidate(routineId?: string) {
  revalidatePath("/routines");
  if (routineId) revalidatePath(`/routines/${routineId}`);
  revalidatePath("/today");
}

/**
 * Upsert today's (or any day's) log. `done` stamps completed_at; `skipped` is
 * an explicit choice that does not break a streak (SPEC §4.2).
 */
export async function logRoutine(
  routineId: string,
  date: string,
  status: "done" | "skipped",
): Promise<void> {
  const input = logInput.parse({ routineId, date, status });
  const supabase = await createClient();
  const userId = await requireUser(supabase);

  const { error } = await supabase.from("routine_logs").upsert(
    {
      user_id: userId,
      routine_id: input.routineId,
      date: input.date,
      status: input.status,
      completed_at: input.status === "done" ? new Date().toISOString() : null,
    },
    { onConflict: "routine_id,date" },
  );
  if (error) throw new Error(`logRoutine: ${error.message}`);

  await cancelRoutinePushes(supabase, userId, input.routineId, input.date);
  revalidate(input.routineId);
}

/** Remove a log (mis-tap, or changed their mind). */
export async function undoRoutineLog(routineId: string, date: string): Promise<void> {
  const input = logInput.omit({ status: true }).parse({ routineId, date });
  const supabase = await createClient();
  const userId = await requireUser(supabase);

  const { error } = await supabase
    .from("routine_logs")
    .delete()
    .eq("user_id", userId)
    .eq("routine_id", input.routineId)
    .eq("date", input.date);
  if (error) throw new Error(`undoRoutineLog: ${error.message}`);

  await restoreRoutinePushes(supabase, userId, input.routineId, input.date);
  revalidate(input.routineId);
}

export async function createRoutine(input: RoutineInput): Promise<string> {
  const values = routineInput.parse(input);
  const supabase = await createClient();
  const userId = await requireUser(supabase);

  const { count } = await supabase
    .from("routines")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  const { data, error } = await supabase
    .from("routines")
    .insert({
      user_id: userId,
      name: values.name,
      emoji: values.emoji || null,
      schedule_days: [...values.schedule_days].sort((a, b) => a - b),
      reminder_time: values.reminder_time || null,
      grace_minutes: values.grace_minutes,
      nudge_enabled: values.nudge_enabled,
      domain_id: values.domain_id || null,
      write_to_calendar: values.write_to_calendar,
      active: values.active,
      sort_order: count ?? 0,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createRoutine: ${error.message}`);

  await syncRoutineCalendar(data.id as string, userId);
  revalidate();
  return data.id as string;
}

export async function updateRoutine(routineId: string, input: RoutineInput): Promise<void> {
  const id = uuid.parse(routineId);
  const values = routineInput.parse(input);
  const supabase = await createClient();
  const userId = await requireUser(supabase);

  const { error } = await supabase
    .from("routines")
    .update({
      name: values.name,
      emoji: values.emoji || null,
      schedule_days: [...values.schedule_days].sort((a, b) => a - b),
      reminder_time: values.reminder_time || null,
      grace_minutes: values.grace_minutes,
      nudge_enabled: values.nudge_enabled,
      domain_id: values.domain_id || null,
      write_to_calendar: values.write_to_calendar,
      active: values.active,
    })
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(`updateRoutine: ${error.message}`);
  await syncRoutineCalendar(id, userId);
  revalidate(id);
}

/** Keeps the recurring calendar event in step (SPEC §6.1b). Best-effort. */
async function syncRoutineCalendar(routineId: string, userId: string): Promise<void> {
  try {
    const { syncRoutineCalendarEvent } = await import("@/lib/integrations/google/calendar-write");
    await syncRoutineCalendarEvent(routineId, userId);
  } catch {
    // a calendar failure must never fail the routine mutation
  }
}

/** Deletes the routine and, by cascade, its logs. */
export async function deleteRoutine(routineId: string): Promise<void> {
  const id = uuid.parse(routineId);
  const supabase = await createClient();
  const userId = await requireUser(supabase);

  // Remove the app-created recurring event first — after the row is gone the
  // event id is unreachable.
  await supabase.from("routines").update({ write_to_calendar: false }).eq("user_id", userId).eq("id", id);
  await syncRoutineCalendar(id, userId);

  const { error } = await supabase.from("routines").delete().eq("user_id", userId).eq("id", id);
  if (error) throw new Error(`deleteRoutine: ${error.message}`);

  await supabase
    .from("notifications")
    .update({ status: "cancelled" })
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .in("kind", ["routine_reminder", "routine_missed"])
    .filter("payload->>routine_id", "eq", id);

  revalidate();
}

export async function toggleRoutineActive(routineId: string, active: boolean): Promise<void> {
  const id = uuid.parse(routineId);
  const isActive = z.boolean().parse(active);
  const supabase = await createClient();
  const userId = await requireUser(supabase);

  const { error } = await supabase
    .from("routines")
    .update({ active: isActive })
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error(`toggleRoutineActive: ${error.message}`);

  if (!isActive) {
    await supabase
      .from("notifications")
      .update({ status: "cancelled" })
      .eq("user_id", userId)
      .eq("status", "scheduled")
      .in("kind", ["routine_reminder", "routine_missed"])
      .filter("payload->>routine_id", "eq", id);
  }
  await syncRoutineCalendar(id, userId); // deactivating removes the recurring event
  revalidate(id);
}

/**
 * Cancel any still-scheduled reminder or missed nudge for this routine on this
 * local day. `scheduled_for` is a timestamptz, so the local day is compared as
 * a UTC half-open range rather than with a ::date cast PostgREST can't express.
 */
async function localDayRange(
  supabase: SupabaseClient,
  userId: string,
  date: string,
): Promise<{ dayStart: string; dayEnd: string }> {
  const { timezone } = await getSettings(supabase, userId);
  return {
    dayStart: fromZonedTime(`${date}T00:00:00`, timezone).toISOString(),
    dayEnd: fromZonedTime(`${addDays(date, 1)}T00:00:00`, timezone).toISOString(),
  };
}

async function cancelRoutinePushes(
  supabase: SupabaseClient,
  userId: string,
  routineId: string,
  date: string,
): Promise<void> {
  const { dayStart, dayEnd } = await localDayRange(supabase, userId, date);

  await supabase
    .from("notifications")
    .update({ status: "cancelled" })
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .in("kind", ["routine_reminder", "routine_missed"])
    .gte("scheduled_for", dayStart)
    .lt("scheduled_for", dayEnd)
    .filter("payload->>routine_id", "eq", routineId);
}

/**
 * The mirror of cancelRoutinePushes: undoing a log puts the day's reminder and
 * missed nudge back on the schedule, but only the ones still in the future.
 * A push whose moment has passed stays cancelled — firing it now would buzz
 * about a time that is already gone.
 */
async function restoreRoutinePushes(
  supabase: SupabaseClient,
  userId: string,
  routineId: string,
  date: string,
): Promise<void> {
  const { dayStart, dayEnd } = await localDayRange(supabase, userId, date);
  const nowIso = new Date().toISOString();
  if (nowIso >= dayEnd) return; // the whole day is behind us

  await supabase
    .from("notifications")
    .update({ status: "scheduled" })
    .eq("user_id", userId)
    .eq("status", "cancelled")
    .in("kind", ["routine_reminder", "routine_missed"])
    .gte("scheduled_for", dayStart)
    .lt("scheduled_for", dayEnd)
    .gt("scheduled_for", nowIso)
    .filter("payload->>routine_id", "eq", routineId);
}
