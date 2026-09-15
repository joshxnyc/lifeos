"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createPerson,
  deletePerson,
  logContact,
  mergePeople,
  setFollowUpCadence,
  updatePerson,
} from "@/lib/people";

// Thin server-action wrappers over lib/people.ts: zod at the boundary, cache
// invalidation after. The logic itself stays in lib so jobs and pipelines can
// call it without going through an action.

const personSchema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(200),
  emails: z.array(z.string().trim().max(320)).max(20).optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  role: z.string().trim().max(200).nullable().optional(),
  domain_id: z.string().uuid().nullable().optional(),
  relationship: z.string().trim().max(300).nullable().optional(),
  tags: z.array(z.string().trim().max(60)).max(30).optional(),
  follow_up_every_days: z.number().int().min(1).max(365).nullable().optional(),
});

function emailsFrom(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

function nullable(value: FormDataEntryValue | null): string | null {
  const v = String(value ?? "").trim();
  return v.length ? v : null;
}

export async function createPersonAction(formData: FormData): Promise<void> {
  const input = personSchema.parse({
    name: String(formData.get("name") ?? ""),
    emails: emailsFrom(formData.get("emails")),
    company: nullable(formData.get("company")),
    role: nullable(formData.get("role")),
    relationship: nullable(formData.get("relationship")),
    domain_id: nullable(formData.get("domain_id")),
    phone: nullable(formData.get("phone")),
  });
  const id = await createPerson(input);
  revalidatePath("/people");
  redirect(`/people/${id}`);
}

export async function updatePersonAction(personId: string, formData: FormData): Promise<void> {
  const patch = personSchema.partial().parse({
    name: String(formData.get("name") ?? ""),
    emails: emailsFrom(formData.get("emails")),
    company: nullable(formData.get("company")),
    role: nullable(formData.get("role")),
    relationship: nullable(formData.get("relationship")),
    domain_id: nullable(formData.get("domain_id")),
    phone: nullable(formData.get("phone")),
  });
  await updatePerson(personId, patch);
  revalidatePath(`/people/${personId}`);
  revalidatePath("/people");
}

export async function savePersonNotesAction(personId: string, notesMd: string): Promise<void> {
  await updatePerson(personId, { notes_md: z.string().max(50_000).parse(notesMd) });
  revalidatePath(`/people/${personId}`);
}

export async function deletePersonAction(personId: string): Promise<void> {
  await deletePerson(z.string().uuid().parse(personId));
  revalidatePath("/people");
  redirect("/people");
}

export async function logContactAction(personId: string, note?: string): Promise<void> {
  await logContact(z.string().uuid().parse(personId), z.string().max(500).optional().parse(note));
  revalidatePath(`/people/${personId}`);
  revalidatePath("/people");
}

export async function setFollowUpCadenceAction(personId: string, days: number | null): Promise<void> {
  await setFollowUpCadence(
    z.string().uuid().parse(personId),
    z.number().int().min(1).max(365).nullable().parse(days),
  );
  revalidatePath(`/people/${personId}`);
  revalidatePath("/people");
}

export async function mergePeopleAction(keepId: string, mergeId: string): Promise<void> {
  await mergePeople(z.string().uuid().parse(keepId), z.string().uuid().parse(mergeId));
  revalidatePath("/people");
  redirect(`/people/${keepId}`);
}
