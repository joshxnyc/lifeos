import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NoteList } from "@/components/notes/note-list";
import { NoteFilters } from "@/components/notes/note-filters";
import { createNote } from "@/app/(app)/notes/actions";
import type { Domain, Note, Person, Project } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string; project?: string; person?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [{ data: domains }, { data: projects }, { data: people }] = await Promise.all([
    supabase.from("domains").select("*").order("sort_order"),
    supabase.from("projects").select("*").eq("status", "active").order("name"),
    supabase.from("people").select("*").order("name"),
  ]);

  const domainId = (domains ?? []).find((d) => d.slug === params.domain)?.id;
  let query = supabase
    .from("notes")
    .select("*")
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(200);
  if (domainId) query = query.eq("domain_id", domainId);
  if (params.project) query = query.eq("project_id", params.project);
  if (params.person) query = query.eq("person_id", params.person);
  const { data: notes } = await query;

  const filtered = Boolean(params.domain || params.project || params.person);

  return (
    <div>
      <PageHeader
        title="Notes"
        subtitle={`${notes?.length ?? 0} ${notes?.length === 1 ? "note" : "notes"}`}
        actions={
          <form action={createNote}>
            <input type="hidden" name="domain_id" value={domainId ?? ""} />
            <input type="hidden" name="project_id" value={params.project ?? ""} />
            <button
              type="submit"
              className="inline-flex h-11 items-center text-[14px] text-accent"
            >
              New note
            </button>
          </form>
        }
      />

      <NoteFilters
        domains={(domains ?? []) as Domain[]}
        projects={(projects ?? []) as Project[]}
        people={(people ?? []) as Person[]}
        current={{ domain: params.domain, project: params.project, person: params.person }}
      />

      {notes?.length ? (
        <NoteList
          notes={notes as Note[]}
          domains={(domains ?? []) as Domain[]}
          projects={(projects ?? []) as Project[]}
        />
      ) : (
        <EmptyState
          line={filtered ? "No notes match this filter." : "No notes yet."}
          action={
            <form action={createNote}>
              <button type="submit" className="text-[14px] font-medium text-accent">
                Write one
              </button>
            </form>
          }
        />
      )}
    </div>
  );
}
