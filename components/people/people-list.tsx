"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PersonAvatar } from "@/components/ui/domain";
import { timeAgo } from "@/components/queue/relative-time";
import type { DomainSlug } from "@/lib/types";

// DESIGN_BRIEF §5.6 — sorted by last contact, "Overdue follow-ups" on top,
// a search field that filters client-side.

export interface PersonRow {
  id: string;
  name: string;
  relationship: string | null;
  company: string | null;
  emails: string[];
  last_contact_at: string | null;
  domain_slug: DomainSlug | null;
  owed: number; // tasks Joshua owes them
  owing: number; // tasks they owe Joshua
  overdue: boolean;
  days_since: number | null;
}

export function PeopleList({ people }: { people: PersonRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      [p.name, p.relationship, p.company, ...(p.emails ?? [])]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q)),
    );
  }, [people, query]);

  const overdue = filtered.filter((p) => p.overdue);
  const rest = filtered.filter((p) => !p.overdue);

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people"
        aria-label="Search people"
        className="mb-6 h-11 w-full rounded-card bg-paper-2 px-3.5 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:ring-1 focus:ring-accent"
      />

      {overdue.length ? (
        <section className="mb-6">
          <h2 className="section-label text-danger">
            Overdue follow-ups · <span className="tabular">{overdue.length}</span>
          </h2>
          <div className="mt-1">
            {overdue.map((p) => (
              <PersonListRow key={p.id} person={p} flagOverdue />
            ))}
          </div>
        </section>
      ) : null}

      {rest.length ? (
        <section>
          <h2 className="section-label">
            {overdue.length ? "Everyone else" : "Everyone"} ·{" "}
            <span className="tabular">{rest.length}</span>
          </h2>
          <div className="mt-1">
            {rest.map((p) => (
              <PersonListRow key={p.id} person={p} />
            ))}
          </div>
        </section>
      ) : null}

      {!filtered.length ? <p className="py-10 text-[15px] text-ink-2">No one matches that.</p> : null}
    </div>
  );
}

function PersonListRow({ person, flagOverdue }: { person: PersonRow; flagOverdue?: boolean }) {
  const counts = [
    person.owed ? `${person.owed} owed` : "",
    person.owing ? `${person.owing} owing` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/people/${person.id}`}
      className="flex min-h-[56px] items-center gap-3 border-b border-line py-3"
    >
      <PersonAvatar name={person.name} slug={person.domain_slug} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-ink">{person.name}</span>
        <span className="block truncate text-[13px] text-ink-2">
          {person.relationship ?? person.company ?? "No relationship set"}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className={`tabular block text-[13px] ${flagOverdue ? "text-danger" : "text-ink-2"}`}
        >
          {timeAgo(person.last_contact_at)}
        </span>
        {counts ? <span className="block text-[12px] text-ink-2">{counts}</span> : null}
      </span>
    </Link>
  );
}
