import Link from "next/link";
import { notFound } from "next/navigation";
import { DomainChip, PersonAvatar } from "@/components/ui/domain";
import { PersonMenu } from "@/components/people/person-menu";
import { PersonNotes } from "@/components/people/person-notes";
import { CadenceStepper } from "@/components/people/cadence-stepper";
import { LogContact } from "@/components/people/log-contact";
import { timeAgo } from "@/components/queue/relative-time";
import { createClient } from "@/lib/supabase/server";
import type { Domain, DomainSlug, Note, Person, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  email_thread: "Email",
  calendar_event: "Calendar",
  notion_page: "Notion",
  granola_note: "Meeting",
};

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: personRow } = await supabase.from("people").select("*").eq("id", id).maybeSingle();
  if (!personRow) notFound();
  const person = personRow as Person;

  const [{ data: domains }, { data: tasks }, { data: notes }, { data: links }, { data: others }] =
    await Promise.all([
      supabase.from("domains").select("id, name, slug").order("sort_order"),
      supabase
        .from("tasks")
        .select("*")
        .eq("person_id", id)
        .eq("status", "open")
        .order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("notes").select("id, title, updated_at").eq("person_id", id).order("updated_at", {
        ascending: false,
      }),
      supabase
        .from("people_source_items")
        .select("role, source_items(id, kind, title, occurred_at, text)")
        .eq("person_id", id)
        .limit(50),
      supabase.from("people").select("id, name").neq("id", id).order("name").limit(500),
    ]);

  const domainList = (domains ?? []) as Pick<Domain, "id" | "name" | "slug">[];
  const domain = domainList.find((d) => d.id === person.domain_id) ?? null;
  const taskRows = (tasks ?? []) as Task[];
  const youOwe = taskRows.filter((t) => t.owner === "me");
  const theyOwe = taskRows.filter((t) => t.owner === "them");

  type TimelineSource = {
    id: string;
    kind: string;
    title: string;
    occurred_at: string | null;
    text: string;
  };
  const timeline: { role: string; item: TimelineSource }[] = [];
  // Supabase types a to-one embed as an array; it is a single row (or null).
  for (const link of (links ?? []) as unknown as {
    role: string;
    source_items: TimelineSource | TimelineSource[] | null;
  }[]) {
    const item = Array.isArray(link.source_items) ? link.source_items[0] : link.source_items;
    if (item) timeline.push({ role: link.role, item });
  }
  timeline.sort((a, b) => String(b.item.occurred_at ?? "").localeCompare(String(a.item.occurred_at ?? "")));

  return (
    <div className="pt-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <PersonAvatar name={person.name} slug={(domain?.slug as DomainSlug) ?? null} size={52} />
          <div className="min-w-0">
            <h1 className="display-title">
              {person.name}
            </h1>
            <p className="mt-1 text-[13px] text-ink-2">
              {[person.relationship, [person.role, person.company].filter(Boolean).join(" at ")]
                .filter(Boolean)
                .join(" · ") || "No relationship set"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {domain ? <DomainChip slug={domain.slug as DomainSlug} name={domain.name} /> : null}
              {(person.emails ?? []).map((email) => (
                <a
                  key={email}
                  href={`mailto:${email}`}
                  className="text-[13px] text-accent underline-offset-2 hover:underline"
                >
                  {email}
                </a>
              ))}
            </div>
          </div>
        </div>
        <PersonMenu
          person={{
            id: person.id,
            name: person.name,
            emails: person.emails,
            company: person.company,
            role: person.role,
            relationship: person.relationship,
            phone: person.phone,
            domain_id: person.domain_id,
          }}
          domains={domainList}
          others={(others ?? []) as { id: string; name: string }[]}
        />
      </div>

      {/* Canvas 1k: cadence and last contact read as one chip line, with the
          actions beneath them. */}
      <section className="mt-3.5 flex flex-wrap items-center gap-2 text-[13px]">
        <CadenceStepper personId={person.id} days={person.follow_up_every_days} />
        <span className="text-ink-2">Last contact {timeAgo(person.last_contact_at)}</span>
      </section>
      <div className="mt-3.5">
        <LogContact personId={person.id} />
      </div>

      <div className="mt-7 grid gap-7 md:grid-cols-2">
        <TaskColumn title="You owe them" tasks={youOwe} empty="Nothing open." />
        <TaskColumn title="They owe you" tasks={theyOwe} empty="Nothing outstanding." />
      </div>

      <section className="mt-7">
        <h2 className="section-label mb-2">
          Notes{(notes ?? []).length ? ` · ${(notes ?? []).length}` : ""}
        </h2>
        <PersonNotes personId={person.id} notesMd={person.notes_md} />
        {(notes ?? []).length ? (
          <ul className="mt-3 border-t border-line">
            {((notes ?? []) as Pick<Note, "id" | "title" | "updated_at">[]).map((n) => (
              <li key={n.id} className="border-b border-line">
                <Link href={`/notes/${n.id}`} className="flex min-h-11 items-center justify-between gap-3 py-2">
                  <span className="truncate text-[15px] text-ink">{n.title || "Untitled note"}</span>
                  <span className="shrink-0 text-[12px] text-ink-2">{timeAgo(n.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-7">
        <h2 className="section-label mb-2">Timeline</h2>
        {timeline.length ? (
          // Canvas 1k: a mono kind column, the title, then how long ago.
          <ul>
            {timeline.map(({ role, item }) => (
              <li key={`${item.id}-${role}`} className="border-b border-line">
                <Link href={`/source/${item.id}`} className="flex min-h-11 items-center gap-3 py-2.5">
                  <span className="w-[52px] shrink-0 font-mono text-[12px] text-ink-2">
                    {SOURCE_LABEL[item.kind] ?? item.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                    {item.title || (item.text ?? "").replace(/\s+/g, " ").slice(0, 90) || "Untitled"}
                  </span>
                  <span className="tabular shrink-0 text-[12px] text-ink-2">
                    {timeAgo(item.occurred_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-ink-2">No emails or meetings linked yet.</p>
        )}
      </section>
    </div>
  );
}

function TaskColumn({ title, tasks, empty }: { title: string; tasks: Task[]; empty: string }) {
  return (
    <section>
      <h2 className="section-label mb-1.5">
        {title}
        {tasks.length ? (
          <>
            {" · "}
            <span className="tabular">{tasks.length}</span>
          </>
        ) : null}
      </h2>
      {tasks.length ? (
        <ul>
          {tasks.map((t) => (
            <li key={t.id} className="flex items-baseline justify-between gap-3 border-b border-line py-2.5">
              <span className="min-w-0 truncate text-[15px] text-ink">{t.title}</span>
              {t.due_date ? (
                <span className="shrink-0 text-[12px] text-ink-2 tabular">{t.due_date}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-ink-2">{empty}</p>
      )}
    </section>
  );
}
