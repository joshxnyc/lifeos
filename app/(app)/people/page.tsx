import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { PeopleList, type PersonRow } from "@/components/people/people-list";
import { PersonFormSheet } from "@/components/people/person-form";
import { createClient } from "@/lib/supabase/server";
import { daysSinceContact, isFollowUpOverdue } from "@/lib/people";
import type { Domain, DomainSlug, Person } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const supabase = await createClient();
  const now = new Date();

  const [{ data: people }, { data: domains }, { data: openTasks }] = await Promise.all([
    supabase
      .from("people")
      .select("*")
      .order("last_contact_at", { ascending: false, nullsFirst: false })
      .limit(1000),
    supabase.from("domains").select("id, name, slug").order("sort_order"),
    supabase.from("tasks").select("person_id, owner").eq("status", "open").not("person_id", "is", null),
  ]);

  const domainList = (domains ?? []) as Pick<Domain, "id" | "name" | "slug">[];
  const slugById = new Map(domainList.map((d) => [d.id, d.slug as DomainSlug]));

  const owed = new Map<string, number>();
  const owing = new Map<string, number>();
  for (const t of openTasks ?? []) {
    const id = String(t.person_id);
    const bucket = t.owner === "them" ? owing : owed;
    bucket.set(id, (bucket.get(id) ?? 0) + 1);
  }

  const rows: PersonRow[] = ((people ?? []) as Person[]).map((p) => ({
    id: p.id,
    name: p.name,
    relationship: p.relationship,
    company: p.company,
    emails: p.emails ?? [],
    last_contact_at: p.last_contact_at,
    domain_slug: p.domain_id ? (slugById.get(p.domain_id) ?? null) : null,
    owed: owed.get(p.id) ?? 0,
    owing: owing.get(p.id) ?? 0,
    overdue: isFollowUpOverdue(p, now),
    days_since: daysSinceContact(p, now),
  }));

  const addButton = (
    <PersonFormSheet
      domains={domainList}
      trigger={<Button variant="secondary">Add person</Button>}
    />
  );

  return (
    <>
      <PageHeader
        title="People"
        subtitle={rows.length ? `${rows.length} tracked` : undefined}
        actions={addButton}
      />
      {rows.length ? (
        <PeopleList people={rows} />
      ) : (
        <EmptyState line="No one here yet. People appear as emails and meetings come in." action={addButton} />
      )}
    </>
  );
}
