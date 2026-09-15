// Quick-add parser (SPEC §9). No LLM: the command palette and the Tasks
// quick-add field both parse here and render a live preview from `tokens`.
//
//   Draft the LP consent memo #tarifa/juicy @bernhard !high fri 3pm ~thu
//
// Unrecognised tokens stay in the title verbatim.

import * as chrono from "chrono-node";
import type { Domain, Person, Project } from "@/lib/types";
import { formatDateParts, isDateString } from "@/lib/domain/dates";

export type QuickAddTokenKind = "domain" | "project" | "person" | "priority" | "due" | "scheduled";

export interface QuickAddToken {
  raw: string;
  kind: QuickAddTokenKind;
}

export interface QuickAddContext {
  domains: Pick<Domain, "id" | "slug" | "name">[];
  projects: Pick<Project, "id" | "name" | "domain_id">[];
  people: Pick<Person, "id" | "name">[];
  /** YYYY-MM-DD in the user's timezone — relative dates resolve against it. */
  today: string;
}

export interface QuickAddResult {
  title: string;
  domain_id?: string;
  project_id?: string;
  person_id?: string;
  priority?: 0 | 1 | 2 | 3;
  due_date?: string;
  due_time?: string;
  scheduled_date?: string;
  tokens: QuickAddToken[];
}

const PRIORITY_WORDS: Record<string, 0 | 1 | 2 | 3> = {
  none: 0,
  low: 1,
  med: 2,
  medium: 2,
  high: 3,
};

/** Longest phrase (in words) a bare date token may span. */
const MAX_DATE_WORDS = 4;

// chrono reads "the week" as next week, which would swallow the end of a title
// like "Plan the week". A date phrase never starts with one of these.
const NOT_A_DATE_START = new Set(["the", "a", "an", "my", "our", "some", "that", "those", "these", "of", "for"]);

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function words(value: string): string[] {
  return value.split(/[\s_/-]+/).filter(Boolean);
}

function prefixMatch<T>(query: string, candidates: T[], keys: (item: T) => string[]): T | undefined {
  const q = norm(query);
  if (!q) return undefined;
  const scored = candidates.map((item) => keys(item).map(norm).filter(Boolean));
  for (const exact of [true, false]) {
    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      const values = scored[i];
      if (!item || !values) continue;
      const hit = values.some((v) => (exact ? v === q : v.startsWith(q)));
      if (hit) return item;
    }
  }
  return undefined;
}

function parsePhrase(phrase: string, today: string): { date: string; time?: string } | null {
  const lead = phrase.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (NOT_A_DATE_START.has(lead)) return null;
  const [y = 0, m = 0, d = 0] = today.split("-").map(Number);
  // Reference at local noon: chrono reads the Date's local fields, and noon
  // keeps "today" stable regardless of the host machine's offset.
  const ref = new Date(y, m - 1, d, 12, 0, 0, 0);
  const results = chrono.parse(phrase, ref, { forwardDate: true });
  const first = results[0];
  if (!first) return null;
  // Only accept a token that is entirely a date: "invoice 30" must stay a title.
  if (first.text.trim().toLowerCase() !== phrase.trim().toLowerCase()) return null;
  const start = first.start;
  const year = start.get("year");
  const month = start.get("month");
  const day = start.get("day");
  if (year == null || month == null || day == null) return null;
  const date = formatDateParts(year, month, day);
  if (!start.isCertain("hour")) return { date };
  const hour = start.get("hour") ?? 0;
  const minute = start.get("minute") ?? 0;
  return { date, time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}

export function parseQuickAdd(input: string, ctx: QuickAddContext): QuickAddResult {
  const today = isDateString(ctx.today) ? ctx.today : new Date().toISOString().slice(0, 10);
  const result: QuickAddResult = { title: "", tokens: [] };
  const kept: string[] = [];
  const parts = input.trim().split(/\s+/).filter(Boolean);

  for (let i = 0; i < parts.length; i++) {
    const word = parts[i];
    if (!word) continue;

    if (word.length > 1 && word.startsWith("#")) {
      const [domainQuery = "", projectQuery = ""] = word.slice(1).split("/", 2);
      const domain = prefixMatch(domainQuery, ctx.domains, (d) => [d.slug, d.name]);
      if (!domain) {
        kept.push(word);
        continue;
      }
      result.domain_id = domain.id;
      const inDomain = ctx.projects.filter((p) => p.domain_id === domain.id);
      const project = projectQuery ? prefixMatch(projectQuery, inDomain, (p) => [p.name, ...words(p.name)]) : undefined;
      if (project) {
        result.project_id = project.id;
        result.tokens.push({ raw: word, kind: "project" });
      } else {
        result.tokens.push({ raw: word, kind: "domain" });
      }
      continue;
    }

    if (word.length > 1 && word.startsWith("@")) {
      const person = prefixMatch(word.slice(1), ctx.people, (p) => [p.name, ...words(p.name)]);
      if (!person) {
        kept.push(word);
        continue;
      }
      result.person_id = person.id;
      result.tokens.push({ raw: word, kind: "person" });
      continue;
    }

    if (word.startsWith("!")) {
      const priority = PRIORITY_WORDS[word.slice(1).toLowerCase()];
      if (priority === undefined) {
        kept.push(word);
        continue;
      }
      result.priority = priority;
      result.tokens.push({ raw: word, kind: "priority" });
      continue;
    }

    if (word.length > 1 && word.startsWith("~")) {
      const remaining = parts.slice(i, i + 3);
      let consumed = 0;
      for (let take = remaining.length; take >= 1 && consumed === 0; take--) {
        const phrase = [remaining[0]?.slice(1) ?? "", ...remaining.slice(1, take)].join(" ").trim();
        const parsed = parsePhrase(phrase, today);
        if (!parsed) continue;
        result.scheduled_date = parsed.date;
        result.tokens.push({ raw: parts.slice(i, i + take).join(" "), kind: "scheduled" });
        consumed = take;
      }
      if (consumed > 0) {
        i += consumed - 1;
        continue;
      }
      kept.push(word);
      continue;
    }

    kept.push(word);
  }

  // A trailing natural date token sets the due date; the title must survive it.
  for (let take = Math.min(MAX_DATE_WORDS, kept.length - 1); take >= 1; take--) {
    const phrase = kept.slice(kept.length - take).join(" ");
    const parsed = parsePhrase(phrase, today);
    if (!parsed) continue;
    result.due_date = parsed.date;
    if (parsed.time) result.due_time = parsed.time;
    result.tokens.push({ raw: phrase, kind: "due" });
    kept.length = kept.length - take;
    break;
  }

  result.title = kept.join(" ").trim();
  return result;
}
