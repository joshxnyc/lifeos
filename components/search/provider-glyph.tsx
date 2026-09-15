import { CalendarDays, FileText, Mail, Mic, Paperclip } from "lucide-react";
import type { SourceKind } from "@/lib/types";

const GLYPHS: Record<SourceKind, typeof Mail> = {
  email_thread: Mail,
  calendar_event: CalendarDays,
  notion_page: FileText,
  granola_note: Mic,
};

export const KIND_LABEL: Record<SourceKind, string> = {
  email_thread: "Email",
  calendar_event: "Event",
  notion_page: "Notion",
  granola_note: "Meeting",
};

/** Small provider mark on archive rows (DESIGN_BRIEF §5.8). */
export function ProviderGlyph({ kind, className }: { kind: string; className?: string }) {
  const Icon = GLYPHS[kind as SourceKind] ?? Paperclip;
  return <Icon className={className ?? "size-4 text-ink-2"} aria-hidden />;
}
