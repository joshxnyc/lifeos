import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callStructured, loadPrompt } from "@/lib/ai/client";
import { buildContext } from "@/lib/ai/context";
import { enqueueNotification } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { addDays, localDate } from "@/lib/time";
import { suggestionDedupeKey } from "@/lib/domain/dedupe";
import type { SourceItem, SuggestionKind, SuggestionProposed, TaskOwner } from "@/lib/types";

// SPEC §7.2 — the extraction sweep. Runs hourly over pending source_items,
// newest first, and writes suggestions into the review queue. Nothing here
// creates a task: AI proposes, Joshua disposes (SPEC design principle 3).

const ITEMS_PER_RUN = 40;
/** Hard stop well inside Vercel's 60s limit; the next tick continues. */
const TIME_BUDGET_MS = 45_000;
const MIN_CONFIDENCE = 0.5;
const DEDUPE_WINDOW_DAYS = 30;
const EXPIRE_AFTER_DAYS = 14;
/** ~6k tokens of item text. */
const MAX_ITEM_CHARS = 24_000;

/**
 * Cheap prefilter for calendar events (SPEC §7.2: "Calendar events only yield
 * suggestions when the description contains action language"). Anything that
 * matches goes to the model; anything that doesn't is marked skipped without
 * spending a call.
 */
const ACTION_LANGUAGE =
  /\b(send|review|prepare|due|deadline|follow.?up|action|todo|to-do|deliver|confirm|sign|submit|share|draft|decide|approve|circulate)\b/i;

interface ExtractedSuggestion {
  kind: SuggestionKind;
  title: string;
  detail: string | null;
  evidence: string;
  proposed: {
    domain_id: string | null;
    project_id: string | null;
    person_id: string | null;
    due_date: string | null;
    priority: number | null;
    existing_task_id: string | null;
    target_date: string | null;
    status: string | null;
    fact: string | null;
    new_person_name: string | null;
    new_person_company: string | null;
    new_person_role: string | null;
  };
  confidence: number;
  owner: TaskOwner;
}

interface ExtractionOutput {
  suggestions: ExtractedSuggestion[];
  nothing_actionable: boolean;
}

const SUGGESTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      description: "The suggestions found in this item. Empty when nothing is actionable.",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["task", "deadline_change", "follow_up", "person_fact", "project_update"],
          },
          title: { type: "string", description: "Short, verb first, in Joshua's register." },
          detail: { type: ["string", "null"], description: "One or two sentences of context, or null." },
          evidence: {
            type: "string",
            description: "Verbatim excerpt from the item, 300 characters or less.",
          },
          proposed: {
            type: "object",
            properties: {
              domain_id: { type: ["string", "null"] },
              project_id: { type: ["string", "null"] },
              person_id: { type: ["string", "null"] },
              due_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
              priority: { type: ["integer", "null"], description: "0 none, 1 low, 2 medium, 3 high" },
              existing_task_id: { type: ["string", "null"], description: "deadline_change only" },
              target_date: { type: ["string", "null"], description: "project_update only, YYYY-MM-DD" },
              status: {
                type: ["string", "null"],
                enum: ["active", "parked", "done", null],
                description: "project_update only",
              },
              fact: { type: ["string", "null"], description: "person_fact only, one sentence" },
              new_person_name: { type: ["string", "null"] },
              new_person_company: { type: ["string", "null"] },
              new_person_role: { type: ["string", "null"] },
            },
            required: [
              "domain_id",
              "project_id",
              "person_id",
              "due_date",
              "priority",
              "existing_task_id",
              "target_date",
              "status",
              "fact",
              "new_person_name",
              "new_person_company",
              "new_person_role",
            ],
            additionalProperties: false,
          },
          confidence: { type: "number", description: "0 to 1, honest." },
          owner: { type: "string", enum: ["me", "them"] },
        },
        required: ["kind", "title", "detail", "evidence", "proposed", "confidence", "owner"],
        additionalProperties: false,
      },
    },
    nothing_actionable: { type: "boolean" },
  },
  required: ["suggestions", "nothing_actionable"],
  additionalProperties: false,
};

const KIND_LABEL: Record<string, string> = {
  email_thread: "Email",
  calendar_event: "Calendar event",
  notion_page: "Notion page",
  granola_note: "Meeting notes",
};

/**
 * One sweep. Idempotent: an item is only picked up while its extraction_status
 * is pending, and every suggestion carries a dedupe key.
 */
export async function runExtractionSweep(
  supabase: SupabaseClient,
  userId: string,
  opts: { now: Date; limit?: number; budgetMs?: number } = { now: new Date() },
): Promise<Record<string, unknown>> {
  const now = opts.now ?? new Date();
  const startedAt = Date.now();
  const budget = opts.budgetMs ?? TIME_BUDGET_MS;
  const settings = await getSettings(supabase, userId);
  const today = localDate(now, settings.timezone);

  // Suggestions older than 14 days auto-expire (SPEC §7.2).
  const expiryCutoff = new Date(now.getTime() - EXPIRE_AFTER_DAYS * 86_400_000).toISOString();
  const { data: expired } = await supabase
    .from("suggestions")
    .update({ status: "expired", resolved_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("status", "pending")
    .lt("created_at", expiryCutoff)
    .select("id");

  const { data: pendingItems } = await supabase
    .from("source_items")
    .select("id, kind, title, text, provider, external_url, occurred_at, domain_id, participants")
    .eq("user_id", userId)
    .eq("extraction_status", "pending")
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .limit(opts.limit ?? ITEMS_PER_RUN);

  const items = (pendingItems ?? []) as Pick<
    SourceItem,
    "id" | "kind" | "title" | "text" | "provider" | "external_url" | "occurred_at" | "domain_id" | "participants"
  >[];

  const stats = {
    items_seen: items.length,
    items_extracted: 0,
    items_skipped: 0,
    items_failed: 0,
    suggestions_written: 0,
    suggestions_below_confidence: 0,
    suggestions_deduped: 0,
    suggestions_expired: expired?.length ?? 0,
    digest_enqueued: false,
    stopped_on_budget: false,
  };

  if (items.length) {
    const context = await buildContext(supabase, userId, settings.timezone);

    const [{ data: openTasks }, { data: pendingSuggestions }, { data: recentKeys }] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, due_date, domain_id")
        .eq("user_id", userId)
        .eq("status", "open")
        .limit(500),
      supabase
        .from("suggestions")
        .select("title")
        .eq("user_id", userId)
        .eq("status", "pending")
        .limit(200),
      supabase
        .from("suggestions")
        .select("dedupe_key")
        .eq("user_id", userId)
        .in("status", ["pending", "dismissed"])
        .gte("created_at", new Date(now.getTime() - DEDUPE_WINDOW_DAYS * 86_400_000).toISOString())
        .limit(2000),
    ]);

    const seenKeys = new Set((recentKeys ?? []).map((r) => r.dedupe_key as string));
    const pendingTitles = (pendingSuggestions ?? []).map((s) => s.title as string);

    for (const item of items) {
      if (Date.now() - startedAt > budget) {
        stats.stopped_on_budget = true;
        break;
      }

      const text = (item.text ?? "").trim();
      if (item.kind === "calendar_event" && !ACTION_LANGUAGE.test(`${item.title} ${text}`)) {
        await markItem(supabase, item.id, "skipped", now);
        stats.items_skipped += 1;
        continue;
      }
      if (!text && !item.title) {
        await markItem(supabase, item.id, "skipped", now);
        stats.items_skipped += 1;
        continue;
      }

      try {
        const domainTasks = (openTasks ?? []).filter(
          (t) => !item.domain_id || t.domain_id === item.domain_id,
        );
        const system = await loadPrompt("extract-commitments", { context });
        const userContent = buildItemPrompt(item, text, domainTasks, pendingTitles);

        const result = await callStructured<ExtractionOutput>({
          pipeline: "extractCommitments",
          system,
          userContent,
          toolName: "propose_suggestions",
          toolDescription: "Return the commitments, requests, deadlines and facts found in this item.",
          schema: SUGGESTION_SCHEMA,
          maxTokens: 3000,
          supabase,
          userId,
          refId: item.id,
        });

        const rows: Record<string, unknown>[] = [];
        for (const suggestion of result.suggestions ?? []) {
          if (!suggestion?.title || typeof suggestion.confidence !== "number") continue;
          if (suggestion.confidence < MIN_CONFIDENCE) {
            stats.suggestions_below_confidence += 1;
            continue;
          }

          const proposed = toProposed(suggestion, item, today);
          const key = suggestionDedupeKey(suggestion.title, proposed.due_date ?? null, proposed.person_id ?? null);
          if (seenKeys.has(key)) {
            stats.suggestions_deduped += 1;
            continue;
          }
          seenKeys.add(key);

          rows.push({
            user_id: userId,
            kind: suggestion.kind,
            title: suggestion.title.slice(0, 300),
            detail: suggestion.detail ?? null,
            proposed,
            evidence: (suggestion.evidence ?? "").slice(0, 300) || null,
            source_item_id: item.id,
            confidence: Math.min(1, Math.max(0, suggestion.confidence)),
            dedupe_key: key,
          });
        }

        if (rows.length) {
          const { error } = await supabase.from("suggestions").insert(rows);
          if (error) throw new Error(error.message);
          stats.suggestions_written += rows.length;
          for (const row of rows) pendingTitles.push(String(row.title));
        }

        await markItem(supabase, item.id, "done", now);
        stats.items_extracted += 1;
      } catch {
        await markItem(supabase, item.id, "failed", now);
        stats.items_failed += 1;
      }
    }
  }

  stats.digest_enqueued = await maybeSendQueueDigest(supabase, userId, now, settings.queue_digest_enabled);
  return stats;
}

async function markItem(
  supabase: SupabaseClient,
  itemId: string,
  status: "done" | "skipped" | "failed",
  now: Date,
): Promise<void> {
  await supabase
    .from("source_items")
    .update({ extraction_status: status, extracted_at: now.toISOString() })
    .eq("id", itemId);
}

function buildItemPrompt(
  item: { kind: string; title: string; provider: string; occurred_at: string | null; domain_id: string | null; participants: unknown },
  text: string,
  openTasks: { id: string; title: string; due_date: string | null }[],
  pendingTitles: string[],
): string {
  const participants = Array.isArray(item.participants)
    ? (item.participants as { name?: string; email?: string; role?: string }[])
        .map((p) => `${p.name ?? p.email ?? "?"}${p.role ? ` (${p.role})` : ""}`)
        .join(", ")
    : "";

  const lines = [
    `## The item`,
    `Kind: ${KIND_LABEL[item.kind] ?? item.kind} (${item.provider})`,
    `Title: ${item.title}`,
    item.occurred_at ? `Occurred: ${item.occurred_at}` : "",
    participants ? `Participants: ${participants}` : "",
    item.domain_id ? `Domain of this item: ${item.domain_id}` : "",
    "",
    "```",
    text.slice(0, MAX_ITEM_CHARS),
    text.length > MAX_ITEM_CHARS ? "\n[truncated]" : "",
    "```",
    "",
    "## Joshua's open tasks in this domain (do not propose these again)",
    openTasks.length
      ? openTasks.map((t) => `- ${t.title}${t.due_date ? ` (due ${t.due_date})` : ""}`).join("\n")
      : "- none",
    "",
    "## Suggestions already waiting in his queue (do not propose these again)",
    pendingTitles.length ? pendingTitles.map((t) => `- ${t}`).join("\n") : "- none",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/**
 * Map the model's flat output onto the SuggestionProposed shape, applying the
 * kind-specific rules: follow-ups are owed by someone else, and a follow-up
 * with no stated date is chased three days out rather than sitting undated.
 */
function toProposed(
  suggestion: ExtractedSuggestion,
  item: { domain_id: string | null },
  today: string,
): SuggestionProposed {
  const p = suggestion.proposed ?? ({} as ExtractedSuggestion["proposed"]);
  const proposed: SuggestionProposed = {};

  const domainId = p.domain_id ?? item.domain_id ?? undefined;
  if (domainId) proposed.domain_id = domainId;
  if (p.project_id) proposed.project_id = p.project_id;
  if (p.person_id) proposed.person_id = p.person_id;
  if (p.due_date) proposed.due_date = p.due_date;
  if (typeof p.priority === "number") proposed.priority = Math.min(3, Math.max(0, Math.round(p.priority)));
  if (p.existing_task_id) proposed.existing_task_id = p.existing_task_id;
  if (p.target_date) proposed.target_date = p.target_date;
  if (p.status === "active" || p.status === "parked" || p.status === "done") proposed.status = p.status;
  if (p.fact) proposed.fact = p.fact;
  if (p.new_person_name) {
    proposed.new_person = {
      name: p.new_person_name,
      ...(p.new_person_company ? { company: p.new_person_company } : {}),
      ...(p.new_person_role ? { role: p.new_person_role } : {}),
    };
  }

  if (suggestion.kind === "follow_up") {
    proposed.owner = "them";
    if (!proposed.due_date) proposed.due_date = addDays(today, 3);
  } else {
    proposed.owner = suggestion.owner === "them" ? "them" : "me";
  }

  return proposed;
}

/**
 * SPEC §8: a queue digest at most once a day, only when at least 3 suggestions
 * are pending. Phrased with the numbers, no adjectives.
 */
async function maybeSendQueueDigest(
  supabase: SupabaseClient,
  userId: string,
  now: Date,
  enabled: boolean,
): Promise<boolean> {
  if (!enabled) return false;

  const { data: pending } = await supabase
    .from("suggestions")
    .select("id, source_item_id, source_items(kind)")
    .eq("user_id", userId)
    .eq("status", "pending")
    .limit(200);

  const rows = (pending ?? []) as {
    id: string;
    source_item_id: string | null;
    source_items?: { kind?: string } | { kind?: string }[] | null;
  }[];
  if (rows.length < 3) return false;

  // Count distinct *sources*, not suggestions: "5 suggestions waiting from
  // 3 emails and 1 meeting".
  const sources = new Map<string, Set<string>>();
  for (const row of rows) {
    const joined = row.source_items;
    const kind = Array.isArray(joined) ? joined[0]?.kind : joined?.kind;
    if (!kind || !row.source_item_id) continue;
    const bucket = kind === "email_thread" ? "email" : kind === "notion_page" ? "page" : "meeting";
    if (!sources.has(bucket)) sources.set(bucket, new Set());
    sources.get(bucket)!.add(row.source_item_id);
  }

  const parts: string[] = [];
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  for (const [bucket, ids] of sources) parts.push(plural(ids.size, bucket));
  const from = parts.length ? ` from ${parts.join(" and ")}` : "";

  return enqueueNotification(supabase, userId, {
    kind: "queue_digest",
    title: "Queue",
    body: `${rows.length} suggestions waiting${from}.`,
    url: "/queue",
    scheduledFor: now,
    payload: { routine_id: "queue_digest" },
    dedupeDaily: true,
  });
}
