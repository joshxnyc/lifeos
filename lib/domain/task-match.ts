// Deterministic task matching: the server-side resolver behind the capture
// pipeline's `task_edit` items. When the model names a task ("the katsu
// task") instead of returning an id from the Open tasks context block,
// createRows() calls this to find which open task is meant. Modeled on
// person-match.ts, but for multi-word titles: exact title, then whole-phrase
// containment, then token-subset scoring. Conservative by design — a unique
// confident match or nothing, because editing the wrong task is worse than
// asking.

export interface TaskCandidate {
  id: string;
  title: string;
}

/**
 * Words that carry no signal about which task is meant. Query-side only —
 * titles are matched as written. "the katsu task" reduces to "katsu".
 */
const FILLER_WORDS = new Set([
  "the",
  "a",
  "an",
  "my",
  "that",
  "this",
  "task",
  "tasks",
  "todo",
  "item",
  "one",
]);

/** Lowercase, strip accents, turn punctuation into spaces, collapse whitespace. */
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Whole-word phrase containment; both sides already normalized. */
function containsPhrase(haystack: string, phrase: string): boolean {
  return ` ${haystack} `.includes(` ${phrase} `);
}

/**
 * The one open task `query` unambiguously names, or null.
 *
 * The query is normalized (case, accents, punctuation) and stripped of filler
 * words ("the", "task", …), then tried in three tiers:
 *
 * 1. exact — the query (raw or stripped) equals the whole title;
 * 2. phrase — the stripped query appears as consecutive whole words in the
 *    title, or the whole title appears inside the query;
 * 3. tokens — every content token of the query appears somewhere in the
 *    title as a whole word, in any order.
 *
 * The first tier with any matches decides: exactly one → that task; two or
 * more → ambiguous, null. Whole-word matching throughout, so "cat" never
 * matches "catering". Empty or all-filler queries return null.
 */
export function matchTaskByTitle<T extends TaskCandidate>(query: string, tasks: T[]): T | null {
  const q = normalize(query);
  if (!q) return null;
  const tokens = q.split(" ").filter((t) => t.length >= 2 && !FILLER_WORDS.has(t));
  if (!tokens.length) return null;
  const phrase = tokens.join(" ");

  const candidates = tasks
    .map((task) => ({ task, norm: normalize(task.title) }))
    .filter((c) => c.norm.length > 0);
  if (!candidates.length) return null;

  const decide = (matches: typeof candidates): T | null =>
    matches.length === 1 ? matches[0]!.task : null;

  // 1. Exact title, with or without the filler words.
  const exact = candidates.filter((c) => c.norm === q || c.norm === phrase);
  if (exact.length) return decide(exact);

  // 2. Whole-phrase containment, either direction.
  const phraseMatches = candidates.filter(
    (c) => containsPhrase(c.norm, phrase) || containsPhrase(phrase, c.norm),
  );
  if (phraseMatches.length) return decide(phraseMatches);

  // 3. Token subset: all content tokens present as whole words, any order.
  const tokenMatches = candidates.filter((c) => {
    const words = new Set(c.norm.split(" "));
    return tokens.every((t) => words.has(t));
  });
  return decide(tokenMatches);
}
