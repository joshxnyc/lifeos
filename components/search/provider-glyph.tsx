import { cn } from "@/lib/utils";
import type { SourceKind } from "@/lib/types";

// Canvas 1l: the provider mark is a 28px paper-2 tile carrying a two-letter
// mono code, not an icon — it sits quietly beside the archive title.
const GLYPHS: Record<SourceKind, string> = {
  email_thread: "GM",
  calendar_event: "CA",
  notion_page: "NO",
  granola_note: "GR",
};

export const KIND_LABEL: Record<SourceKind, string> = {
  email_thread: "Email",
  calendar_event: "Event",
  notion_page: "Notion",
  granola_note: "Meeting",
};

/** Small provider mark on archive rows (DESIGN_BRIEF §5.8). */
export function ProviderGlyph({ kind, className }: { kind: string; className?: string }) {
  const code = GLYPHS[kind as SourceKind] ?? "··";
  return (
    <span
      aria-label={KIND_LABEL[kind as SourceKind] ?? "Source"}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-paper-2 font-mono text-[11px] text-ink-2",
        className,
      )}
    >
      {code}
    </span>
  );
}
