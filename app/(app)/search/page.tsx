import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchField } from "@/components/search/search-field";
import { RANGES, SearchFilters } from "@/components/search/search-filters";
import { KIND_LABEL, ProviderGlyph } from "@/components/search/provider-glyph";
import { Highlight, queryTerms, snippet } from "@/components/search/highlight";
import { DOMAIN_COLOR_CLASS } from "@/components/ui/domain";
import { cn } from "@/lib/utils";
import type { Domain, DomainSlug, Note, Person, SourceItem, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

const LIMIT = 15;

/**
 * Keyword search v1 (SPEC §2, DESIGN_BRIEF §5.8): Postgres full-text over the
 * generated `search_vector` columns. Semantic search comes later.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; domain?: string; kind?: string; range?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const supabase = await createClient();

  const { data: domainRows } = await supabase.from("domains").select("*").order("sort_order");
  const domains = (domainRows ?? []) as Domain[];
  const domainId = domains.find((d) => d.slug === params.domain)?.id;
  const domainById = new Map(domains.map((d) => [d.id, d]));
  const terms = queryTerms(q);

  let tasks: Task[] = [];
  let notes: Note[] = [];
  let people: Person[] = [];
  let archive: SourceItem[] = [];

  if (q) {
    const since = RANGES[params.range ?? "all"]?.days ?? null;
    const sinceIso = since ? new Date(Date.now() - since * 86_400_000).toISOString() : null;

    let taskQuery = supabase
      .from("tasks")
      .select("*")
      .textSearch("search_vector", q, { type: "websearch" })
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(LIMIT);
    if (domainId) taskQuery = taskQuery.eq("domain_id", domainId);

    let noteQuery = supabase
      .from("notes")
      .select("*")
      .textSearch("search_vector", q, { type: "websearch" })
      .order("updated_at", { ascending: false })
      .limit(LIMIT);
    if (domainId) noteQuery = noteQuery.eq("domain_id", domainId);

    let peopleQuery = supabase
      .from("people")
      .select("*")
      .textSearch("search_vector", q, { type: "websearch" })
      .order("last_contact_at", { ascending: false, nullsFirst: false })
      .limit(LIMIT);
    if (domainId) peopleQuery = peopleQuery.eq("domain_id", domainId);

    let archiveQuery = supabase
      .from("source_items")
      .select("*")
      .textSearch("search_vector", q, { type: "websearch" })
      .order("occurred_at", { ascending: false, nullsFirst: false })
      .limit(LIMIT);
    if (domainId) archiveQuery = archiveQuery.eq("domain_id", domainId);
    if (params.kind) archiveQuery = archiveQuery.eq("kind", params.kind);
    if (sinceIso) archiveQuery = archiveQuery.gte("occurred_at", sinceIso);

    const [t, n, p, a] = await Promise.all([taskQuery, noteQuery, peopleQuery, archiveQuery]);
    tasks = (t.data ?? []) as Task[];
    notes = (n.data ?? []) as Note[];
    people = (p.data ?? []) as Person[];
    archive = (a.data ?? []) as SourceItem[];
  }

  const total = tasks.length + notes.length + people.length + archive.length;

  return (
    <div>
      <PageHeader title="Search" subtitle={q ? `${total} ${total === 1 ? "result" : "results"}` : undefined} />
      <SearchField initial={q} />
      <SearchFilters domains={domains} current={params} />

      {!q ? (
        <EmptyState line="Search tasks, notes, people and everything the app has archived." />
      ) : total === 0 ? (
        <EmptyState
          line={`Nothing matches “${q}”.`}
          action={
            <Link href="/search" className="text-[14px] font-medium text-accent">
              Clear the filters
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-7 pb-10">
          {tasks.length ? (
            <Section title="Tasks">
              {tasks.map((task) => {
                const domain = domainById.get(task.domain_id);
                return (
                  <Row key={task.id} href={`/tasks?task=${task.id}`} slug={domain?.slug as DomainSlug}>
                    <span className="block truncate text-[15px] text-ink">
                      <Highlight text={task.title} terms={terms} />
                    </span>
                    <span className="mt-0.5 block text-[12px] text-ink-2">
                      {task.status === "done" ? "Done" : task.status === "dropped" ? "Dropped" : "Open"}
                      {task.due_date ? ` · due ${task.due_date}` : ""}
                      {task.is_mirror ? " · Notion" : ""}
                    </span>
                  </Row>
                );
              })}
            </Section>
          ) : null}

          {notes.length ? (
            <Section title="Notes">
              {notes.map((note) => {
                const domain = note.domain_id ? domainById.get(note.domain_id) : undefined;
                return (
                  <Row key={note.id} href={`/notes/${note.id}`} slug={domain?.slug as DomainSlug}>
                    <span className="block truncate font-display text-[17px] text-ink">
                      <Highlight text={note.title || "Untitled"} terms={terms} />
                    </span>
                    <span className="mt-0.5 block text-[13px] text-ink-2">
                      <Highlight text={snippet(note.body_md, terms, 160)} terms={terms} />
                    </span>
                  </Row>
                );
              })}
            </Section>
          ) : null}

          {people.length ? (
            <Section title="People">
              {people.map((person) => {
                const domain = person.domain_id ? domainById.get(person.domain_id) : undefined;
                return (
                  <Row key={person.id} href={`/people/${person.id}`} slug={domain?.slug as DomainSlug}>
                    <span className="block truncate text-[15px] text-ink">
                      <Highlight text={person.name} terms={terms} />
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-2">
                      {[person.relationship, person.company, person.role].filter(Boolean).join(" · ") ||
                        person.emails[0] ||
                        "No details yet"}
                    </span>
                  </Row>
                );
              })}
            </Section>
          ) : null}

          {archive.length ? (
            <Section title="Archive">
              {archive.map((item) => (
                <Row key={item.id} href={`/source/${item.id}`}>
                  <span className="flex items-center gap-2">
                    <ProviderGlyph kind={item.kind} />
                    <span className="min-w-0 flex-1 truncate text-[15px] text-ink">
                      <Highlight text={item.title || KIND_LABEL[item.kind]} terms={terms} />
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-2">
                      {item.occurred_at ? item.occurred_at.slice(0, 10) : ""}
                    </span>
                  </span>
                  <span className="mt-1 block text-[13px] text-ink-2">
                    <Highlight text={snippet(item.text, terms)} terms={terms} />
                  </span>
                </Row>
              ))}
            </Section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="section-label mb-2">{title}</h2>
      <ul>{children}</ul>
    </section>
  );
}

function Row({
  href,
  slug,
  children,
}: {
  href: string;
  slug?: DomainSlug;
  children: React.ReactNode;
}) {
  return (
    <li className="border-b border-line">
      <Link href={href} className="flex min-h-[44px] items-start gap-3 py-3 active:bg-paper-2">
        <span
          className={cn(
            "mt-1 h-8 w-[3px] shrink-0 rounded-full",
            slug ? DOMAIN_COLOR_CLASS[slug] : "bg-transparent",
          )}
        />
        <span className="min-w-0 flex-1">{children}</span>
      </Link>
    </li>
  );
}
