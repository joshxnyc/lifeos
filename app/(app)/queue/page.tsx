import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SuggestionCard } from "@/components/queue/suggestion-card";
import { timeAgo } from "@/components/queue/relative-time";
import { createClient } from "@/lib/supabase/server";
import type { Domain, Project, Suggestion, SuggestionProposed } from "@/lib/types";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  email_thread: "Email",
  calendar_event: "Calendar",
  notion_page: "Notion",
  granola_note: "Meeting",
};

type JoinedSource = {
  id: string;
  kind: string;
  title: string;
  occurred_at: string | null;
  participants: { name?: string; email?: string; role?: string }[] | null;
} | null;

export default async function QueuePage() {
  const supabase = await createClient();

  const [{ data: suggestions }, { data: domains }, { data: projects }, { data: people }, { data: lastRun }] =
    await Promise.all([
      supabase
        .from("suggestions")
        .select("*, source_items(id, kind, title, occurred_at, participants)")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("domains").select("id, name, slug").order("sort_order"),
      supabase.from("projects").select("id, name, domain_id").eq("status", "active").order("name"),
      supabase.from("people").select("id, name").order("name").limit(500),
      supabase
        .from("job_runs")
        .select("finished_at, started_at, status")
        .eq("job", "extract")
        .eq("status", "ok")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const rows = (suggestions ?? []) as (Suggestion & { source_items: JoinedSource })[];
  const domainList = (domains ?? []) as Pick<Domain, "id" | "name" | "slug">[];
  const projectList = (projects ?? []) as Pick<Project, "id" | "name" | "domain_id">[];
  const peopleList = (people ?? []) as { id: string; name: string }[];

  const sweep = lastRun?.finished_at ?? lastRun?.started_at ?? null;

  if (!rows.length) {
    return (
      <>
        <PageHeader title="Queue" />
        <EmptyState
          line={`Nothing waiting. Last sweep ${timeAgo(sweep)}.`}
          action={
            <Link href="/today" className="text-[14px] text-accent">
              Back to Today
            </Link>
          }
        />
      </>
    );
  }

  // Newest first, grouped under their source (DESIGN_BRIEF §5.3). Group order
  // follows the newest suggestion in each group.
  const groups: { key: string; source: JoinedSource; items: typeof rows }[] = [];
  for (const row of rows) {
    const key = row.source_item_id ?? "none";
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, source: row.source_items ?? null, items: [] };
      groups.push(group);
    }
    group.items.push(row);
  }

  return (
    <>
      <PageHeader
        title="Queue"
        subtitle={`${rows.length} waiting · last sweep ${timeAgo(sweep)}`}
      />

      <div className="space-y-7">
        {groups.map((group) => {
          const source = group.source;
          const header = sourceHeader(source);
          return (
            <section key={group.key}>
              {source ? (
                <Link
                  href={`/source/${source.id}`}
                  className="section-label flex min-h-11 items-center hover:text-ink"
                >
                  {header}
                </Link>
              ) : (
                <p className="section-label flex min-h-11 items-center">{header}</p>
              )}
              <div className="border-t border-line">
                {group.items.map((item) => (
                  <SuggestionCard
                    key={item.id}
                    id={item.id}
                    kind={item.kind}
                    title={item.title}
                    detail={item.detail}
                    evidence={item.evidence}
                    confidence={item.confidence}
                    proposed={(item.proposed ?? {}) as SuggestionProposed}
                    domains={domainList}
                    projects={projectList}
                    people={peopleList}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function sourceHeader(source: JoinedSource): string {
  if (!source) return "No source";
  const label = SOURCE_LABEL[source.kind] ?? "Source";
  const sender = (source.participants ?? []).find((p) => p?.role === "from");
  const who = sender?.name ?? sender?.email ?? source.title;
  const when = timeAgo(source.occurred_at);
  return [label, who, when].filter(Boolean).join(" · ");
}
