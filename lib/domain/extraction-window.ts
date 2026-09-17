// Incremental email extraction (2026-09-17). Gmail archives a whole thread as
// one source_item, so every reply used to re-send the entire thread to the
// model. After a successful extraction the sweep records how far into the
// (trimmed) text it read as `raw.extracted_upto`; the next pass sends only the
// tail beyond that offset. The full text is still stored and searchable —
// only the LLM input shrinks. Pure so it can be tested directly.

/**
 * Where extraction should start reading, given the offset recorded on the
 * row's raw jsonb. Anything implausible — not an integer, negative, zero, or
 * at/past the end of the current text — falls back to the full text, so a
 * corrupt or stale marker can never hide content from the model.
 */
export function extractionOffset(raw: unknown, textLength: number): number {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return 0;
  const value = (raw as Record<string, unknown>).extracted_upto;
  if (typeof value !== "number" || !Number.isInteger(value)) return 0;
  if (value <= 0 || value >= textLength) return 0;
  return value;
}

/**
 * How far this pass actually read: the offset it started from plus what fit
 * inside the per-item character cap. Stored as the next `extracted_upto`, so
 * a thread longer than the cap is continued, not silently dropped.
 */
export function reviewedUpto(offset: number, textLength: number, maxChars: number): number {
  return Math.min(textLength, offset + maxChars);
}
