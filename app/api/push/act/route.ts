import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { completeTask } from "@/app/(app)/tasks/actions";
import { enqueueNotification } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { localDate } from "@/lib/time";
import {
  SNOOZE_MINUTES,
  normalizeDueTime,
  snoozeRoutineId,
  taskDueLabel,
} from "@/lib/domain/task-reminders";

// The target of the service worker's notification action buttons (app/sw.ts):
// "Done" completes the task, "Snooze 1h" re-enqueues its deadline reminder.
// Auth is the same-origin session cookie the SW sends with credentials:
// "include" — signed out means 401 and the SW shows its fallback notification.

const actSchema = z.object({
  action: z.enum(["complete", "snooze"]),
  task_id: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = actSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { action, task_id } = parsed.data;

  if (action === "complete") {
    // The same server action the in-app Done button runs: mirror guard,
    // completed_at stamp, recurrence spawn, calendar "✓" — one code path.
    const result = await completeTask(task_id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, id: result.id, spawnedId: result.spawnedId });
  }

  // Snooze: a fresh task_due row one hour out. The routine_id suffix keeps it
  // clear of the dedupe index; payload.snoozed lets notifications-tick send it
  // even when the deadline has passed by then, while its other guards (task
  // still open, deadline unchanged) still apply at send time.
  const { data: task } = await supabase
    .from("tasks")
    .select("title, status, owner, is_mirror, due_date, due_time")
    .eq("id", task_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "That task no longer exists." }, { status: 409 });
  if (task.is_mirror || task.owner !== "me") {
    return NextResponse.json({ error: "Not a task the app reminds about." }, { status: 409 });
  }
  if (task.status !== "open") {
    return NextResponse.json({ error: "That task is no longer open." }, { status: 409 });
  }
  if (!task.due_date) {
    return NextResponse.json({ error: "The task no longer has a deadline." }, { status: 409 });
  }

  const settings = await getSettings(supabase, user.id);
  const today = localDate(new Date(), settings.timezone);
  const fireAt = new Date(Date.now() + SNOOZE_MINUTES * 60_000);
  const deadline = { due_date: task.due_date as string, due_time: task.due_time as string | null };

  try {
    await enqueueNotification(supabase, user.id, {
      kind: "task_due",
      title: `${taskDueLabel(deadline, today)} · ${task.title}`,
      body: "",
      url: `/tasks?task=${task_id}`,
      scheduledFor: fireAt,
      payload: {
        routine_id: snoozeRoutineId(task_id, fireAt),
        task_id,
        due_date: deadline.due_date,
        due_time: normalizeDueTime(deadline.due_time),
        snoozed: true,
      },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't schedule the reminder." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, scheduled_for: fireAt.toISOString() });
}
