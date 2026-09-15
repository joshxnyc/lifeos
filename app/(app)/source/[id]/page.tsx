import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, FileText, Mail, NotebookPen, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DomainChip, PersonAvatar } from "@/components/ui/domain";
import type { Domain, Person, SourceItem, SourceKind, Suggestion, Task } from "@/lib/types";

/**
 * Archive item view (DESIGN_BRIEF §5.8): the full cleaned text of an email
 * thread, meeting, Notion page or calendar event, who was on it, a link back
 * to the source, and what the extraction sweep made of it.
 */

const GLYPH: Record<SourceKind, typeof Mail> = {
  email_thread: Mail,
  calendar_event: CalendarDays,
  notion_page: FileText,
  granola_note: NotebookPen,
};

const KIND_LABEL: Record<SourceKind, string> = {
  email_thread: "Email thread",
  calendar_event: "Calendar event",
  notion_page: "Notion page",
  granola_note: "Meeting note",
};

const ROLE_LABEL: Record<string, string> = {
  from: "From",
  to: "To",
  cc: "Cc",
  attendee: "Attendee",
  mentioned: "Mentioned",
};

export default async function SourceItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: itemRow } = await supabase.from("source_items").select("*").eq("id", id).maybeSingle();
  const item = itemRow as SourceItem | null;
  if (!item) notFound();

  const [{ data: links }, { data: suggestionRows }, { data: taskRows }, { data: domainRows }] =
    await Promise.all([
      supabase
        .from("people_source_items")
        .select("role, person:people(id, name, domain_id, relationship)")
        .eq("source_item_id", id),
      supabase
        .from("suggestions")
        .select("*")
        .eq("source_item_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("*")
        .eq("source_item_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("domains").select("*"),
    ]);

  const domains = (domainRows ?? []) as Domain[];
  const domain = domains.find((d) => d.id === item.domain_id);
  const suggestions = (suggestionRows ?? []) as Suggestion[];
  const tasks = (taskRows ?? []) as Task[];
  // PostgREST returns an embedded to-one relation as an object, but older
  // clients hand back a single-element array — normalise both.
  const matched = ((links ?? []) as Array<{ role: string; person: Person | Person[] | null }>)
    .map((l) => ({ role: l.role, person: Array.isArray(l.person) ? (l.person[0] ?? null) : l.person }))
    .filter((l): l is { role: string; person: Person } => Boolean(l.person));
  const matchedEmails = new Set(
    matched.flatMap((l) => (l.person.emails ?? []).map((e) => e.toLowerCase())),
  );
  const unmatched = (item.participants ?? []).filter(
    (p) => !p.email || !matchedEmails.has(p.email.toLowerCase()),
  );

  const Glyph = GLYPH[item.kind] ?? FileText;
  const produced = suggestions.length + tasks.length;

  return (
    <div className="pt-6">
      <div className="mb-1 flex items-center gap-2 text-ink-2">
        <Glyph size={16} strokeWidth={1.75} />
        <span className="section-label">{KIND_LABEL[item.kind] ?? item.kind}</span>
        {domain ? <DomainChip slug={domain.slug} name={domain.name} /> : null}
      </div>

      <h1 className="display-title">{item.title}</h1>

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <span className="tabular font-mono text-[12px] text-ink-2">
          {item.occurred_at
            ? new Date(item.occurred_at).toLocaleString()
            : new Date(item.fetched_at).toLocaleString()}
        </span>
        {item.external_url ? (
          <a
            href={item.external_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[13px] text-accent"
          >
            Open original <ExternalLink size={13} />
          </a>
        ) : null}
      </div>

      {matched.length || unmatched.length ? (
        <div className="mt-5">
          <p className="section-label mb-2">Participants</p>
          <div className="flex flex-wrap items-center gap-2">
            {matched.map((link) => (
              <Link
                key={`${link.person.id}-${link.role}`}
                href={`/people/${link.person.id}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-2 pr-3 text-[13px] text-ink"
              >
                <PersonAvatar
                  name={link.person.name}
                  slug={domains.find((d) => d.id === link.person.domain_id)?.slug}
                  size={24}
                />
                {link.person.name}
                <span className="text-ink-2">{ROLE_LABEL[link.role] ?? link.role}</span>
              </Link>
            ))}
            {unmatched.map((p, index) => (
              <span
                key={`${p.email ?? p.name ?? index}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-3 text-[13px] text-ink-2"
              >
                {p.name || p.email}
                {p.role ? <span className="text-ink-2">{ROLE_LABEL[p.role] ?? p.role}</span> : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6 max-w-[68ch] whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
        {item.text || "No text was captured for this item."}
      </div>

      <div className="mt-8 border-t border-line pt-5">
        <p className="section-label mb-2">
          {produced === 0
            ? "This produced nothing yet"
            : `This produced ${produced} ${produced === 1 ? "item" : "items"}`}
        </p>

        {produced === 0 ? (
          <p className="text-[13px] text-ink-2">
            {item.extraction_status === "pending"
              ? "Waiting for the next extraction sweep."
              : `Extraction ${item.extraction_status}.`}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {suggestions.map((s) => (
              <Link
                key={s.id}
                href="/queue"
                className="flex min-h-11 items-center justify-between gap-3 rounded-card border border-line px-3 py-2 text-[14px]"
              >
                <span className="min-w-0 truncate">{s.title}</span>
                <span className="shrink-0 text-[13px] text-ink-2">{s.status}</span>
              </Link>
            ))}
            {tasks.map((t) => (
              <Link
                key={t.id}
                href={`/tasks?task=${t.id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-card border border-line px-3 py-2 text-[14px]"
              >
                <span className="min-w-0 truncate">{t.title}</span>
                <span className="shrink-0 text-[13px] text-ink-2">
                  {t.status === "done" ? "done" : (t.due_date ?? "task")}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
