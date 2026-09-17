// Deterministic person matching: the server-side safety net behind the
// filing prompt's "link known people" rule. When the model leaves person_id
// null but the text plainly names exactly one known person, createRows()
// links them. Conservative by design — whole-word matches only, and any
// ambiguity returns null, because a wrong link is worse than no link.

export interface KnownPerson {
  id: string;
  name: string;
}

/** Lowercase, strip accents, collapse whitespace. */
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word test: the name must not touch another letter or digit. */
function containsWholeWord(normalizedText: string, normalizedName: string): boolean {
  if (!normalizedName) return false;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(normalizedName).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`,
    "u",
  );
  return pattern.test(normalizedText);
}

/**
 * The id of the one known person `text` unambiguously mentions, or null.
 *
 * Matching is case- and accent-insensitive on whole words: first the full
 * name ("Lucas Fernandez"), then a bare first name — but a first name only
 * counts when exactly one known person has it. Null whenever zero or more
 * than one person matches at the level tried. "Lucastro" never matches
 * "Lucas"; "with Lucas." does.
 */
export function matchPersonInText(text: string, people: KnownPerson[]): string | null {
  const haystack = normalize(text);
  if (!haystack) return null;

  // 1. Full-name matches win. More than one full name in the text is
  //    ambiguous about which item is whose, so link nothing.
  const fullMatches = people.filter((p) => {
    const full = normalize(p.name);
    return full.includes(" ") && containsWholeWord(haystack, full);
  });
  if (fullMatches.length === 1) return fullMatches[0]!.id;
  if (fullMatches.length > 1) return null;

  // 2. First names, but only ones exactly one known person has. Single-word
  //    names ("Lucas" with no surname) are treated as first names here.
  const byFirstName = new Map<string, KnownPerson[]>();
  for (const p of people) {
    const first = normalize(p.name).split(" ")[0] ?? "";
    if (first.length < 2) continue; // an initial is not a name to match on
    byFirstName.set(first, [...(byFirstName.get(first) ?? []), p]);
  }

  const firstMatches: KnownPerson[] = [];
  for (const [first, owners] of byFirstName) {
    if (owners.length !== 1) continue; // shared first name → never auto-link
    if (containsWholeWord(haystack, first)) firstMatches.push(owners[0]!);
  }
  return firstMatches.length === 1 ? firstMatches[0]!.id : null;
}
