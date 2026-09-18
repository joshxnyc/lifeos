// Suggestion dedupe keys (SPEC §7.2): the extraction sweep runs hourly over
// the same archive, so the same commitment must hash to the same key every
// time or the queue fills with repeats. Synchronous by design — the sweep
// computes keys inside a tight loop and crypto.subtle is async.

/** Lowercase, drop punctuation and accents, collapse whitespace. */
export function normalizeForDedupe(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(hash, 33) + input.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function hex(value: number): string {
  return value.toString(16).padStart(8, "0");
}

export function suggestionDedupeKey(
  title: string,
  due: string | null | undefined,
  personId: string | null | undefined,
): string {
  const payload = [normalizeForDedupe(title), due ?? "", personId ?? ""].join("|");
  // Two independent 32-bit hashes concatenated: 64 bits is plenty for a
  // per-user, 30-day dedupe window and keeps the key short enough to index.
  return `${hex(fnv1a(payload))}${hex(djb2(payload))}`;
}
