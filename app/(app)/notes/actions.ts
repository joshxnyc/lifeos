"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const nullableUuid = z.union([uuid, z.literal("")]).nullish();

const updateSchema = z.object({
  id: uuid,
  title: z.string().max(300).optional(),
  body_md: z.string().max(200000).optional(),
  domain_id: nullableUuid,
  project_id: nullableUuid,
  person_id: nullableUuid,
});

export type NoteActionResult = { ok: true } | { ok: false; error: string };

async function client() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}

const clean = (value: string | null | undefined) => (value ? value : null);

/** New empty note, then straight into the editor. */
export async function createNote(formData?: FormData): Promise<void> {
  const { supabase, userId } = await client();
  if (!userId) redirect("/login");

  const domainId = formData?.get("domain_id");
  const projectId = formData?.get("project_id");
  const { data, error } = await supabase
    .from("notes")
    .insert({
      user_id: userId,
      title: "",
      body_md: "",
      domain_id: typeof domainId === "string" && domainId ? domainId : null,
      project_id: typeof projectId === "string" && projectId ? projectId : null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the note.");

  revalidatePath("/notes");
  redirect(`/notes/${data.id}`);
}

/** Autosave target: debounced from the editor, so it is called often. */
export async function updateNote(input: z.infer<typeof updateSchema>): Promise<NoteActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid note." };
  const { id, ...fields } = parsed.data;

  const { supabase, userId } = await client();
  if (!userId) return { ok: false, error: "Not signed in." };

  const patch: Record<string, unknown> = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.body_md !== undefined) patch.body_md = fields.body_md;
  if (fields.domain_id !== undefined) patch.domain_id = clean(fields.domain_id);
  if (fields.project_id !== undefined) patch.project_id = clean(fields.project_id);
  if (fields.person_id !== undefined) patch.person_id = clean(fields.person_id);
  if (!Object.keys(patch).length) return { ok: true };

  const { error } = await supabase.from("notes").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  // CONTRACTS rule 8: a note write that touches a project bumps dormancy.
  const projectId = clean(fields.project_id);
  if (projectId) {
    await supabase.from("projects").update({ last_activity_at: new Date().toISOString() }).eq("id", projectId);
  }

  revalidatePath("/notes");
  revalidatePath(`/notes/${id}`);
  return { ok: true };
}

export async function setNotePinned(id: string, pinned: boolean): Promise<NoteActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid note." };
  const { supabase, userId } = await client();
  if (!userId) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.from("notes").update({ pinned }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/notes");
  revalidatePath(`/notes/${id}`);
  return { ok: true };
}

export async function deleteNote(id: string): Promise<void> {
  if (!uuid.safeParse(id).success) throw new Error("Invalid note.");
  const { supabase, userId } = await client();
  if (!userId) redirect("/login");

  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/notes");
  redirect("/notes");
}
