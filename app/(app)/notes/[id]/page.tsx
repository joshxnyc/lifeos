import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { NoteEditor } from "@/components/notes/note-editor";
import type { Domain, Note, Person, Project } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: note }, { data: domains }, { data: projects }, { data: people }] = await Promise.all([
    supabase.from("notes").select("*").eq("id", id).maybeSingle(),
    supabase.from("domains").select("*").order("sort_order"),
    supabase.from("projects").select("*").eq("status", "active").order("name"),
    supabase.from("people").select("*").order("name"),
  ]);
  if (!note) notFound();

  return (
    <div>
      {/* PWA standalone has no browser chrome, so every screen carries its own back. */}
      <Link
        href="/notes"
        className="mt-4 inline-flex h-11 items-center gap-1 text-[13px] text-ink-2 hover:text-ink"
      >
        <ChevronLeft className="size-4" />
        Notes
      </Link>
      <NoteEditor
        note={note as Note}
        domains={(domains ?? []) as Domain[]}
        projects={(projects ?? []) as Project[]}
        people={(people ?? []) as Person[]}
      />
    </div>
  );
}
