import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callStructured, callText, loadPrompt, MODEL_CHEAP } from "@/lib/ai/client";
import { buildContext } from "@/lib/ai/context";
import { getSettings } from "@/lib/settings";
import { enqueueNotification } from "@/lib/notify";
import { matchPersonInText } from "@/lib/domain/person-match";
import { matchTaskByTitle } from "@/lib/domain/task-match";
import { localDate } from "@/lib/time";
import { mimeForExt, transcribeAudio, transcriptionPrompt } from "@/lib/transcribe";
import type { Capture, CaptureResult } from "@/lib/types";

/**
 * Capture filing (SPEC §7.1): transcribe (voice only) → clean → file.
 *
 * Runs from POST /api/capture for text captures (fast enough to await) and
 * from the process-captures job for audio and for stragglers. Idempotent:
 * a capture already `done` is left alone, and a capture that already has a
 * transcript is not transcribed again.
 */

const NULLABLE_STRING = { type: ["string", "null"] } as const;

/** Transcripts shorter than this skip the cleanup pass — see step 2 below. */
const CLEANUP_MIN_CHARS = 240;

/** The §7.1 output schema, flattened so Anthropic strict tool use accepts it. */
export const FILE_CAPTURE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["items", "needs_clarification"],
  properties: {
    items: {
      type: "array",
      description: "Everything this capture should create. May be empty.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "title",
          "body_md",
          "domain_id",
          "project_id",
          "person_id",
          "due_date",
          "due_time",
          "priority",
          "routine_id",
          "routine_date",
          "routine_status",
          "fact",
          "new_person",
          "duration_minutes",
          "task_id",
          "target_title",
          "changes",
        ],
        properties: {
          type: {
            type: "string",
            enum: ["task", "note", "routine_log", "person_update", "reminder", "task_edit"],
          },
          title: { ...NULLABLE_STRING, description: "Task/reminder/note title in Joshua's own words." },
          body_md: { ...NULLABLE_STRING, description: "Markdown detail. Required for a note." },
          domain_id: { ...NULLABLE_STRING, description: "Domain id from the context block." },
          project_id: { ...NULLABLE_STRING, description: "Project id from the context block, or null." },
          person_id: { ...NULLABLE_STRING, description: "Person id from the context block, or null." },
          due_date: { ...NULLABLE_STRING, description: "YYYY-MM-DD, resolved against today." },
          due_time: { ...NULLABLE_STRING, description: "HH:mm, 24-hour, or null." },
          priority: { type: ["integer", "null"], description: "0 none, 1 low, 2 medium, 3 high." },
          duration_minutes: {
            type: ["integer", "null"],
            description:
              "task/reminder only: realistic estimate of active time in whole minutes when the activity has a natural length, else null.",
          },
          routine_id: { ...NULLABLE_STRING, description: "routine_log only: routine id from the context." },
          routine_date: { ...NULLABLE_STRING, description: "routine_log only: YYYY-MM-DD." },
          routine_status: {
            ...NULLABLE_STRING,
            description: 'routine_log only: exactly "done" or "skipped".',
          },
          fact: { ...NULLABLE_STRING, description: "person_update only: one sentence." },
          new_person: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["name", "company", "role"],
            description: "A person not in the context block, when confident it is one.",
            properties: {
              name: { type: "string" },
              company: NULLABLE_STRING,
              role: NULLABLE_STRING,
            },
          },
          task_id: {
            ...NULLABLE_STRING,
            description: "task_edit only: id of the open task being changed, from the Open tasks context.",
          },
          target_title: {
            ...NULLABLE_STRING,
            description:
              "task_edit only: Joshua's words for which task, for server-side resolution when task_id is null.",
          },
          changes: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["due_date", "due_time", "scheduled_date", "priority", "title", "status"],
            description: "task_edit only: the fields to change. Null fields are left untouched.",
            properties: {
              due_date: { ...NULLABLE_STRING, description: "New due date YYYY-MM-DD, or null." },
              due_time: { ...NULLABLE_STRING, description: "New due time HH:mm (24-hour), or null." },
              scheduled_date: {
                ...NULLABLE_STRING,
                description: "New scheduled (work-on-it) date YYYY-MM-DD, or null.",
              },
              priority: { type: ["integer", "null"], description: "New priority 0-3, or null." },
              title: { ...NULLABLE_STRING, description: "New title for a rename, or null." },
              status: {
                ...NULLABLE_STRING,
                description: 'Exactly "done" or "dropped", or null to leave the task open.',
              },
            },
          },
        },
      },
    },
    needs_clarification: {
      ...NULLABLE_STRING,
      description: "One short sentence when something could not be resolved, else null.",
    },
  },
};

interface TaskEditChanges {
  due_date: string | null;
  due_time: string | null;
  scheduled_date: string | null;
  priority: number | null;
  title: string | null;
  status: "done" | "dropped" | null;
}

interface FiledItemInput {
  type: "task" | "note" | "routine_log" | "person_update" | "reminder" | "task_edit";
  title: string | null;
  body_md: string | null;
  domain_id: string | null;
  project_id: string | null;
  person_id: string | null;
  due_date: string | null;
  due_time: string | null;
  priority: number | null;
  duration_minutes: number | null;
  routine_id: string | null;
  routine_date: string | null;
  routine_status: "done" | "skipped" | null;
  fact: string | null;
  new_person: { name: string; company: string | null; role: string | null } | null;
  task_id: string | null;
  target_title: string | null;
  changes: TaskEditChanges | null;
}

interface FileCaptureOutput {
  items: FiledItemInput[];
  needs_clarification: string | null;
}

/**
 * Push "A capture didn't file" when this capture now sits in `failed`. The
 * status is read back from the row rather than inferred from a throw, because
 * an empty capture lands `failed` without throwing. Deduped per capture per
 * local day on payload.routine_id, so the capture route's after() path and a
 * later cron retry of the same capture can both call this without spamming.
 * Best-effort: alerting must never fail the caller.
 */
export async function notifyIfCaptureFailed(
  supabase: SupabaseClient,
  userId: string,
  captureId: string,
): Promise<boolean> {
  try {
    const { data: after } = await supabase
      .from("captures")
      .select("status, error")
      .eq("id", captureId)
      .single();
    if (after?.status !== "failed") return false;
    return await enqueueNotification(supabase, userId, {
      kind: "custom",
      title: "A capture didn't file",
      body: ((after.error as string | null) ?? "Filing failed.").split("\n")[0]!.slice(0, 200),
      url: "/capture",
      scheduledFor: new Date(),
      payload: { routine_id: `capture_failed:${captureId}` },
      dedupeDaily: true,
    });
  } catch {
    return false;
  }
}

export async function processCapture(
  supabase: SupabaseClient,
  userId: string,
  captureId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("captures")
    .select("*")
    .eq("id", captureId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new Error(`Capture ${captureId} not found: ${error?.message ?? "missing"}`);
  const capture = data as Capture;
  if (capture.status === "done") return;

  try {
    const settings = await getSettings(supabase, userId);
    const tz = settings.timezone;

    // 1. Transcribe (voice only, and only once).
    let transcript = capture.transcript ?? capture.raw_text ?? null;
    if (capture.audio_path && !capture.transcript) {
      await supabase.from("captures").update({ status: "transcribing" }).eq("id", captureId);
      transcript = await transcribeCaptureAudio(supabase, userId, capture.audio_path, captureId);
      await supabase.from("captures").update({ transcript }).eq("id", captureId);
    }
    if (!transcript || !transcript.trim()) {
      await supabase
        .from("captures")
        .update({ status: "failed", error: "Nothing to file: the capture is empty." })
        .eq("id", captureId);
      return;
    }

    // 2. Cheap cleanup pass — long voice transcripts only.
    //
    //    Typed captures are already Joshua's exact words, so cleaning them
    //    would only risk changing them. Short clips are skipped too (added
    //    2026-09-16 for perceived speed): cleanup is a whole extra LLM
    //    round-trip, and on a one-or-two-sentence clip it saves the filing
    //    pass nothing — that prompt already tolerates filler and false
    //    starts. Only a long ramble is worth tidying first.
    let cleaned = capture.cleaned_text ?? null;
    if (!cleaned) {
      const worthCleaning = Boolean(capture.audio_path) && transcript.trim().length >= CLEANUP_MIN_CHARS;
      cleaned = worthCleaning
        ? (
            await callText({
              pipeline: "clean-transcript",
              model: MODEL_CHEAP,
              system: await loadPrompt("clean-transcript"),
              userContent: transcript,
              maxTokens: 1500,
              supabase,
              userId,
              refId: captureId,
            })
          ).trim() || transcript
        : transcript;
      await supabase.from("captures").update({ cleaned_text: cleaned, status: "filing" }).eq("id", captureId);
    } else {
      await supabase.from("captures").update({ status: "filing" }).eq("id", captureId);
    }

    // 3. File it.
    const [context, domains] = await Promise.all([
      buildContext(supabase, userId, tz),
      supabase.from("domains").select("id, slug").eq("user_id", userId),
    ]);
    const personalDomainId =
      (domains.data ?? []).find((d) => d.slug === "personal")?.id ?? (domains.data ?? [])[0]?.id ?? null;
    if (!personalDomainId) throw new Error("No domains exist; run the Phase 0 seed first");

    // A capture that failed part-way through filing may have created tasks
    // before it died. It never showed a result, so clear them rather than
    // leave duplicates behind when this run files the same text again.
    if (!capture.result) {
      await supabase.from("tasks").delete().eq("origin", "capture").eq("origin_id", captureId);
    }

    const output = await callStructured<FileCaptureOutput>({
      pipeline: "file-capture",
      system: await loadPrompt("file-capture", {
        context,
        today: localDate(new Date(), tz),
        timezone: tz,
        personalDomainId,
      }),
      userContent: cleaned,
      toolName: "file_capture",
      toolDescription: "File this capture into tasks, notes, routine logs, reminders and person updates.",
      schema: FILE_CAPTURE_SCHEMA,
      maxTokens: 2048,
      supabase,
      userId,
      refId: captureId,
    });

    const result = await createRows(supabase, userId, captureId, output, {
      personalDomainId,
      timezone: tz,
      domainIds: new Set((domains.data ?? []).map((d) => d.id)),
    });

    await supabase.from("captures").update({ result, status: "done", error: null }).eq("id", captureId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Audio is kept so the capture can be retried from the capture screen.
    await supabase
      .from("captures")
      .update({ status: "failed", error: message.slice(0, 2000) })
      .eq("id", captureId);
    throw err;
  }
}

async function transcribeCaptureAudio(
  supabase: SupabaseClient,
  userId: string,
  audioPath: string,
  captureId: string,
): Promise<string> {
  const { data: blob, error } = await supabase.storage.from("captures").download(audioPath);
  if (error || !blob) throw new Error(`Audio download failed: ${error?.message ?? "missing file"}`);
  const bytes = Buffer.from(await blob.arrayBuffer());
  const ext = audioPath.split(".").pop() ?? "m4a";

  const [domains, projects, people, routines] = await Promise.all([
    supabase.from("domains").select("name").eq("user_id", userId),
    supabase.from("projects").select("name").eq("user_id", userId).eq("status", "active"),
    supabase
      .from("people")
      .select("name")
      .eq("user_id", userId)
      .order("last_contact_at", { ascending: false, nullsFirst: false })
      .limit(60),
    supabase.from("routines").select("name").eq("user_id", userId).eq("active", true),
  ]);
  const names = (rows: { name: string }[] | null) => (rows ?? []).map((r) => r.name);
  const hint = transcriptionPrompt({
    domains: names(domains.data),
    projects: names(projects.data),
    people: names(people.data),
    routines: names(routines.data),
  });

  const { text } = await transcribeAudio({
    audio: bytes,
    mime: mimeForExt(ext),
    prompt: hint,
    supabase,
    userId,
    refId: captureId,
  });
  return text;
}

async function createRows(
  supabase: SupabaseClient,
  userId: string,
  captureId: string,
  output: FileCaptureOutput,
  ctx: { personalDomainId: string; timezone: string; domainIds: Set<string> },
): Promise<CaptureResult> {
  const items: CaptureResult["items"] = [];
  const touchedProjects = new Set<string>();
  const notes: string[] = [];
  const today = localDate(new Date(), ctx.timezone);

  // Ids the model returned are validated against the real tables: a
  // hallucinated id would otherwise fail the foreign key and lose the capture.
  const [projectRows, peopleRows, routineRows, openTaskRows] = await Promise.all([
    supabase.from("projects").select("id").eq("user_id", userId),
    supabase.from("people").select("id, name, notes_md").eq("user_id", userId),
    supabase.from("routines").select("id").eq("user_id", userId),
    // task_edit targets. Open and non-mirror only: a mirrored (Notion) task is
    // never edited from here, and a closed one is not a live edit target.
    supabase
      .from("tasks")
      .select("id, title, project_id")
      .eq("user_id", userId)
      .eq("status", "open")
      .eq("is_mirror", false),
  ]);
  const projectIds = new Set((projectRows.data ?? []).map((r) => r.id as string));
  const peopleById = new Map(
    (peopleRows.data ?? []).map((r) => [r.id as string, r as { id: string; name: string; notes_md: string | null }]),
  );
  const knownPeople = (peopleRows.data ?? []).map((r) => ({ id: r.id as string, name: r.name as string }));
  const routineIds = new Set((routineRows.data ?? []).map((r) => r.id as string));
  const openTasks = (openTaskRows.data ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    project_id: (r.project_id as string | null) ?? null,
  }));
  const openTaskById = new Map(openTasks.map((t) => [t.id, t]));

  for (const item of output.items ?? []) {
    const domainId = item.domain_id && ctx.domainIds.has(item.domain_id) ? item.domain_id : ctx.personalDomainId;
    const projectId = item.project_id && projectIds.has(item.project_id) ? item.project_id : null;
    let personId = item.person_id && peopleById.has(item.person_id) ? item.person_id : null;
    // Safety net behind the prompt's "link known people" rule: when the model
    // left person_id null but the text plainly names exactly one known
    // person (whole word, unambiguous), link them anyway. Deterministic and
    // conservative — see matchPersonInText.
    if (!personId && (item.type === "task" || item.type === "reminder" || item.type === "note")) {
      personId = matchPersonInText([item.title, item.body_md].filter(Boolean).join("\n"), knownPeople);
    }
    if (projectId) touchedProjects.add(projectId);

    if (item.type === "task_edit") {
      const named = item.target_title?.trim() || item.title?.trim() || "";
      // The id must come from the fetched open non-mirror set — a hallucinated,
      // closed or mirrored id falls through to title resolution instead.
      let target = item.task_id ? (openTaskById.get(item.task_id) ?? null) : null;
      if (!target && named) target = matchTaskByTitle(named, openTasks);
      if (!target) {
        notes.push(
          named
            ? `Couldn't find an open task like "${named}" — nothing was changed.`
            : "An edit named no findable task — nothing was changed.",
        );
        continue;
      }

      const changes = item.changes;
      const update: Record<string, unknown> = {};
      const details: string[] = [];
      if (changes?.due_date) {
        update.due_date = changes.due_date;
        if (changes.due_time) update.due_time = changes.due_time;
        details.push(`moved to ${changes.due_date}${changes.due_time ? ` at ${changes.due_time}` : ""}`);
      } else if (changes?.due_time) {
        update.due_time = changes.due_time;
        details.push(`moved to ${changes.due_time}`);
      }
      if (changes?.scheduled_date) {
        update.scheduled_date = changes.scheduled_date;
        details.push(`scheduled for ${changes.scheduled_date}`);
      }
      if (typeof changes?.priority === "number") {
        const p = clampPriority(changes.priority);
        update.priority = p;
        details.push(`priority ${PRIORITY_WORDS[p]}`);
      }
      const newTitle = changes?.title?.trim();
      if (newTitle) {
        update.title = newTitle;
        details.push(`renamed to "${newTitle}"`);
      }
      if (changes?.status === "done") {
        update.status = "done";
        update.completed_at = new Date().toISOString();
        details.push("marked done");
      } else if (changes?.status === "dropped") {
        update.status = "dropped";
        update.dropped_reason = "Dropped via capture";
        details.push("dropped");
      }

      if (!Object.keys(update).length) {
        notes.push(`No change to apply to "${target.title}".`);
        continue;
      }

      // RLS scopes the update to Joshua's rows; the explicit filters repeat
      // the never-edit-a-mirror rule at the write itself.
      const { error: updateError } = await supabase
        .from("tasks")
        .update(update)
        .eq("id", target.id)
        .eq("user_id", userId)
        .eq("is_mirror", false);
      if (updateError) {
        notes.push(`Couldn't update "${target.title}": ${updateError.message}`);
        continue;
      }
      if (target.project_id) touchedProjects.add(target.project_id);
      // "task_edit" is in CaptureResult's union, but an edit cannot be undone
      // by deletion: there is no created row. The panel hides its Undo button
      // and the undo action's zod enum rejects the type at runtime as a second
      // line of defense. summarizeCapture renders it via its NOUNS map, which
      // has a "task_edit" entry.
      items.push({
        type: "task_edit",
        id: target.id,
        title: newTitle || target.title,
        detail: details.join(" · ") || undefined,
      });
      continue;
    }

    if (item.type === "task" || item.type === "reminder") {
      const title = item.title?.trim();
      if (!title) continue;
      // The estimate lands in the column (calendar-write reads it for the
      // block length) and stays in the body so it is visible on the task.
      const durationMinutes = normalizeDuration(item.duration_minutes);
      const { data: task } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          domain_id: domainId,
          project_id: projectId,
          person_id: personId,
          title,
          body_md: withEstimate(item.body_md, durationMinutes),
          duration_minutes: durationMinutes,
          due_date: item.due_date || null,
          due_time: item.due_time || null,
          priority: clampPriority(item.priority),
          owner: "me",
          origin: "capture",
          origin_id: captureId,
        })
        .select("id")
        .single();
      if (task) {
        items.push({
          type: item.type,
          id: task.id as string,
          title,
          detail: detailLabel(item.due_date, item.due_time, durationMinutes) ?? undefined,
          ...(durationMinutes ? { duration_minutes: durationMinutes } : {}),
        });
      }
      continue;
    }

    if (item.type === "note") {
      const title = item.title?.trim() || firstLine(item.body_md) || "Note";
      const { data: note } = await supabase
        .from("notes")
        .insert({
          user_id: userId,
          title,
          body_md: item.body_md?.trim() || "",
          domain_id: domainId,
          project_id: projectId,
          person_id: personId,
        })
        .select("id")
        .single();
      if (note) items.push({ type: "note", id: note.id as string, title });
      continue;
    }

    if (item.type === "routine_log") {
      if (!item.routine_id || !routineIds.has(item.routine_id)) {
        notes.push("A routine was mentioned that does not exist yet.");
        continue;
      }
      const status = item.routine_status === "skipped" ? "skipped" : "done";
      const date = item.routine_date || today;
      const { data: log } = await supabase
        .from("routine_logs")
        .upsert(
          {
            user_id: userId,
            routine_id: item.routine_id,
            date,
            status,
            completed_at: status === "done" ? new Date().toISOString() : null,
          },
          { onConflict: "routine_id,date" },
        )
        .select("id")
        .single();
      const { data: routine } = await supabase
        .from("routines")
        .select("name")
        .eq("id", item.routine_id)
        .single();
      if (log) {
        items.push({
          type: "routine_log",
          id: log.id as string,
          title: (routine?.name as string) ?? "Routine",
          detail: status === "done" ? `marked done for ${date}` : `skipped for ${date}`,
        });
      }
      continue;
    }

    if (item.type === "person_update") {
      const fact = item.fact?.trim();
      if (!fact) continue;
      let targetId = personId;
      let targetName: string | null = null;

      if (!targetId && item.new_person?.name?.trim()) {
        const { data: person } = await supabase
          .from("people")
          .insert({
            user_id: userId,
            name: item.new_person.name.trim(),
            company: item.new_person.company?.trim() || null,
            role: item.new_person.role?.trim() || null,
            domain_id: domainId,
          })
          .select("id, name, notes_md")
          .single();
        if (person) {
          targetId = person.id as string;
          targetName = person.name as string;
          peopleById.set(targetId, { id: targetId, name: targetName, notes_md: null });
          // Later items in this same capture can now link to them too.
          knownPeople.push({ id: targetId, name: targetName });
        }
      }
      if (!targetId) {
        notes.push(`Kept a fact without a person: ${fact}`);
        continue;
      }

      const existing = peopleById.get(targetId)?.notes_md ?? null;
      const line = `- [${today}] ${fact}`;
      const nextNotes = existing ? `${existing.trimEnd()}\n${line}` : line;
      await supabase.from("people").update({ notes_md: nextNotes }).eq("id", targetId);
      peopleById.set(targetId, {
        id: targetId,
        name: targetName ?? peopleById.get(targetId)?.name ?? "",
        notes_md: nextNotes,
      });

      if (!targetName) {
        const { data: person } = await supabase.from("people").select("name").eq("id", targetId).single();
        targetName = (person?.name as string) ?? "Person";
      }
      items.push({ type: "person_update", id: targetId, title: targetName, detail: fact });
    }
  }

  // SPEC §4.1 / CONTRACTS rule 8: any write touching a project bumps dormancy.
  if (touchedProjects.size) {
    await supabase
      .from("projects")
      .update({ last_activity_at: new Date().toISOString() })
      .in("id", Array.from(touchedProjects));
  }

  const clarification = [output.needs_clarification?.trim() || "", ...notes].filter(Boolean).join(" ");
  return { items, needs_clarification: clarification || undefined };
}

/** Indexed by the 0–3 priority scale, for human-readable edit details. */
const PRIORITY_WORDS = ["none", "low", "medium", "high"] as const;

function clampPriority(value: number | null): 0 | 1 | 2 | 3 {
  const n = Math.round(value ?? 0);
  if (n <= 0) return 0;
  if (n >= 3) return 3;
  return n as 1 | 2;
}

function firstLine(text: string | null): string | null {
  const line = text?.split("\n").find((l) => l.trim());
  return line ? line.replace(/^#+\s*/, "").trim().slice(0, 80) : null;
}

/** Whole minutes inside a plausible range, or null. A day is the ceiling. */
function normalizeDuration(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const minutes = Math.round(value);
  if (minutes < 1 || minutes > 1440) return null;
  return minutes;
}

/** The estimate as the body's last line, so it survives into the task detail. */
function withEstimate(body: string | null, minutes: number | null): string | null {
  const text = body?.trim() || "";
  if (!minutes) return text || null;
  return text ? `${text}\n\nEstimated: ${minutes} min` : `Estimated: ${minutes} min`;
}

function detailLabel(date: string | null, time: string | null, minutes: number | null): string | null {
  const due = date ? (time ? `due ${date} at ${time}` : `due ${date}`) : null;
  const estimate = minutes ? `${minutes} min` : null;
  return [due, estimate].filter(Boolean).join(" · ") || null;
}
