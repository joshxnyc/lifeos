import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { blockTimeForTask, NoWritableCalendarError } from "@/lib/integrations/google/calendar-write";
import { safeErrorMessage } from "@/lib/integrations/accounts";

const Body = z.object({ taskId: z.string().uuid() });

/**
 * "Block time" on a task (Today / Task row action, SPEC §6.1). Returns 501
 * with a plain message when no Google account has a writable calendar yet, so
 * the caller can point Joshua at Settings instead of failing silently.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

  // Mirrored Notion tasks are read-only in every surface (CONTRACTS rule 7).
  const { data: task } = await supabase
    .from("tasks")
    .select("id, is_mirror")
    .eq("id", parsed.data.taskId)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (task.is_mirror) {
    return NextResponse.json({ error: "Mirrored tasks cannot be blocked" }, { status: 400 });
  }

  try {
    const result = await blockTimeForTask(parsed.data.taskId, user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof NoWritableCalendarError) {
      return NextResponse.json({ error: "No writable calendar configured" }, { status: 501 });
    }
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 });
  }
}
