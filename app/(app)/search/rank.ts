// Relevance ordering for search results (pure TS, no migration).
//
// Supabase's .textSearch returns rows unranked, so each group's candidates
// (already capped at LIMIT by the query) get a small scoring pass here:
// a term found in the title outweighs one found only in the body, repeated
// mentions in the body count a little (capped so a long email can't drown a
// precise title hit), and recency breaks ties. Real ts_rank would need an
// .rpc() function and a migration; this covers the same intuition for the
// handful of rows a page shows.

const TITLE_HIT = 8;
const TITLE_ALL_TERMS_BONUS = 4;
const BODY_HIT_CAP = 5;

export interface RankFields {
  title: string;
  body?: string | null;
  /** ISO timestamp used as the tiebreak; null sorts last among equals. */
  recency?: string | null;
}

/** Occurrences of `term` in `haystack` (both already lowercased), capped. */
function countOccurrences(haystack: string, term: string, cap: number): number {
  let count = 0;
  let at = haystack.indexOf(term);
  while (at >= 0 && count < cap) {
    count += 1;
    at = haystack.indexOf(term, at + term.length);
  }
  return count;
}

export function matchScore(fields: RankFields, terms: string[]): number {
  if (!terms.length) return 0;
  const title = fields.title.toLowerCase();
  const body = (fields.body ?? "").toLowerCase();
  let score = 0;
  let titleHits = 0;
  for (const term of terms) {
    if (title.includes(term)) {
      score += TITLE_HIT;
      titleHits += 1;
    }
    score += countOccurrences(body, term, BODY_HIT_CAP);
  }
  if (titleHits === terms.length) score += TITLE_ALL_TERMS_BONUS;
  return score;
}

/** Rows reordered best match first; recency (newest first) breaks ties. */
export function byBestMatch<T>(rows: T[], terms: string[], pick: (row: T) => RankFields): T[] {
  return rows
    .map((row, index) => {
      const fields = pick(row);
      return { row, index, score: matchScore(fields, terms), recency: fields.recency ?? "" };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.recency !== b.recency) return a.recency > b.recency ? -1 : 1;
      return a.index - b.index; // stable for identical rows
    })
    .map((entry) => entry.row);
}
