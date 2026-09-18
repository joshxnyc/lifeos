import type { ReactNode } from "react";

/** Query terms, minus websearch operators, lowercased. */
export function queryTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .replace(/["'()]/g, " ")
        .split(/\s+/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 1 && !["or", "and", "not"].includes(t)),
    ),
  );
}

/** A window of text around the first match, for archive result snippets. */
export function snippet(text: string, terms: string[], length = 220): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) return flat.slice(0, length) + (flat.length > length ? "…" : "");
  const start = Math.max(0, at - Math.floor(length / 3));
  const end = Math.min(flat.length, start + length);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** Matches marked in accent-soft (DESIGN_BRIEF §5.8). */
export function Highlight({ text, terms }: { text: string; terms: string[] }): ReactNode {
  if (!terms.length || !text) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "ig");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        terms.includes(part.toLowerCase()) ? (
          <mark key={i} className="rounded-[3px] bg-accent-soft px-0.5 text-ink">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
