import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { localDate } from "@/lib/time";
import type { Person, PersonSourceItem } from "@/lib/types";

// SPEC §4.3 / §10 Phase 5: people are created and linked automatically from
// email participants and calendar attendees, with a merge tool for duplicates.
// Everything here is server-side; the UI calls the thin server actions in
// app/(app)/people/actions.ts, which wrap these functions.

type ParticipantRole = PersonSourceItem["role"];

const ROLE_MAP: Record<string, ParticipantRole> = {
  from: "from",
  sender: "from",
  author: "from",
  to: "to",
  recipient: "to",
  cc: "cc",
  bcc: "cc",
  attendee: "attendee",
  organizer: "attendee",
  participant: "attendee",
  mentioned: "mentioned",
};

function normalizeRole(role: string | undefined): ParticipantRole {
  if (!role) return "attendee";
  return ROLE_MAP[role.trim().toLowerCase()] ?? "attendee";
}

/**
 * Addresses that must never become a person: automated senders. Matching is on
 * the local part, plus a few machine domains. Deliberately conservative — a
 * miss here only means link-only behaviour, never a wrong contact card.
 */
const AUTOMATED_LOCAL =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|reply|bounce[s]?|mailer[-_.]?daemon|postmaster|notification[s]?|notify|alert[s]?|news|newsletter[s]?|updates?|digest|billing|invoice[s]?|receipts?|noreply.*|automated|robot|bot|mail|email|hello|info|admin|webmaster|unsubscribe)$/i;
const AUTOMATED_DOMAIN = /(^|\.)(bounces?|email|mail|mailer|notifications?|sendgrid|mailgun|amazonses|postmarkapp)\./i;

function isAutomatedAddress(email: string): boolean {
  const [local = "", domain = ""] = email.split("@");
  if (AUTOMATED_LOCAL.test(local)) return true;
  if (/no[-_.]?reply/i.test(local)) return true;
  if (AUTOMATED_DOMAIN.test(domain)) return true;
  return false;
}

function looksLikeAPersonName(name: string | undefined, email: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  if (trimmed.includes("@")) return false; // clients that use the address as the name
  if (trimmed.toLowerCase() === email.split("@")[0]?.toLowerCase()) return false;
  return true;
}

function maxIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Link a source item's participants to people (SPEC §4.3 people_source_items).
 *
 * Matching is by email, case-insensitively, against `people.emails`. A person
 * is created automatically only when the participant carries **both** a real
 * name and an address that is not Joshua's own and not an automated sender;
 * everything else is link-only (matched people are linked, unknown addresses
 * are ignored). `last_contact_at` moves forward to the source item's
 * `occurred_at`, never backwards.
 *
 * Called by A4's `upsertSourceItem` for every fetched email, event, page and
 * meeting note, so it must be idempotent and cheap.
 */
export async function linkParticipantsToPeople(
  supabase: SupabaseClient,
  userId: string,
  sourceItemId: string,
  participants: { name?: string; email?: string; role?: string }[],
): Promise<void> {
  if (!participants?.length) return;

  const { data: item } = await supabase
    .from("source_items")
    .select("id, occurred_at, domain_id")
    .eq("id", sourceItemId)
    .maybeSingle();
  if (!item) return;
  const occurredAt: string | null = item.occurred_at ?? null;

  // Joshua's own addresses: every connected account identity.
  const { data: accounts } = await supabase
    .from("connected_accounts")
    .select("external_identity")
    .eq("user_id", userId);
  const ownEmails = new Set(
    (accounts ?? [])
      .map((a) => String(a.external_identity ?? "").toLowerCase())
      .filter((e) => e.includes("@")),
  );

  const { data: peopleRows } = await supabase
    .from("people")
    .select("id, name, emails, last_contact_at")
    .eq("user_id", userId)
    .limit(2000);

  const byEmail = new Map<string, { id: string; last_contact_at: string | null }>();
  for (const p of peopleRows ?? []) {
    for (const e of (p.emails ?? []) as string[]) {
      byEmail.set(String(e).toLowerCase(), { id: p.id, last_contact_at: p.last_contact_at ?? null });
    }
  }

  const links: { user_id: string; person_id: string; source_item_id: string; role: ParticipantRole }[] = [];
  const contactBumps = new Map<string, { id: string; last_contact_at: string | null }>();

  for (const participant of participants) {
    const email = participant.email?.trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (ownEmails.has(email)) continue;

    let match = byEmail.get(email);

    if (!match) {
      if (isAutomatedAddress(email)) continue;
      if (!looksLikeAPersonName(participant.name, email)) continue;

      const { data: created } = await supabase
        .from("people")
        .insert({
          user_id: userId,
          name: participant.name!.trim(),
          emails: [email],
          domain_id: item.domain_id ?? null,
          last_contact_at: occurredAt,
        })
        .select("id, last_contact_at")
        .single();
      if (!created) continue;
      match = { id: created.id, last_contact_at: created.last_contact_at ?? null };
      byEmail.set(email, match);
    }

    links.push({
      user_id: userId,
      person_id: match.id,
      source_item_id: sourceItemId,
      role: normalizeRole(participant.role),
    });
    contactBumps.set(match.id, match);
  }

  if (links.length) {
    await supabase
      .from("people_source_items")
      .upsert(links, { onConflict: "person_id,source_item_id,role", ignoreDuplicates: true });
  }

  if (occurredAt) {
    for (const person of contactBumps.values()) {
      const next = maxIso(person.last_contact_at, occurredAt);
      if (next && next !== person.last_contact_at) {
        await supabase.from("people").update({ last_contact_at: next }).eq("id", person.id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mutations. Wrapped as server actions in app/(app)/people/actions.ts.
// ---------------------------------------------------------------------------

async function rlsClient(): Promise<{ supabase: SupabaseClient; userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

export interface PersonInput {
  name: string;
  emails?: string[];
  phone?: string | null;
  company?: string | null;
  role?: string | null;
  domain_id?: string | null;
  relationship?: string | null;
  tags?: string[];
  follow_up_every_days?: number | null;
}

function normalizeEmails(emails: string[] | undefined): string[] {
  return Array.from(
    new Set((emails ?? []).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"))),
  );
}

export async function createPerson(input: PersonInput): Promise<string> {
  const { supabase, userId } = await rlsClient();
  const { data, error } = await supabase
    .from("people")
    .insert({
      user_id: userId,
      name: input.name.trim(),
      emails: normalizeEmails(input.emails),
      phone: input.phone ?? null,
      company: input.company ?? null,
      role: input.role ?? null,
      domain_id: input.domain_id ?? null,
      relationship: input.relationship ?? null,
      tags: input.tags ?? [],
      follow_up_every_days: input.follow_up_every_days ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createPerson: ${error.message}`);
  return data.id;
}

export async function updatePerson(personId: string, patch: Partial<PersonInput> & { notes_md?: string | null }): Promise<void> {
  const { supabase } = await rlsClient();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.emails !== undefined) update.emails = normalizeEmails(patch.emails);
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.company !== undefined) update.company = patch.company;
  if (patch.role !== undefined) update.role = patch.role;
  if (patch.domain_id !== undefined) update.domain_id = patch.domain_id;
  if (patch.relationship !== undefined) update.relationship = patch.relationship;
  if (patch.tags !== undefined) update.tags = patch.tags;
  if (patch.notes_md !== undefined) update.notes_md = patch.notes_md;
  if (patch.follow_up_every_days !== undefined) update.follow_up_every_days = patch.follow_up_every_days;
  if (!Object.keys(update).length) return;
  const { error } = await supabase.from("people").update(update).eq("id", personId);
  if (error) throw new Error(`updatePerson: ${error.message}`);
}

export async function deletePerson(personId: string): Promise<void> {
  const { supabase } = await rlsClient();
  const { error } = await supabase.from("people").delete().eq("id", personId);
  if (error) throw new Error(`deletePerson: ${error.message}`);
}

/**
 * "Log contact": last contact is now, the cadence clock restarts, and an
 * optional one-line note is appended to notes_md under today's date.
 */
export async function logContact(personId: string, note?: string): Promise<void> {
  const { supabase, userId } = await rlsClient();
  const settings = await getSettings(supabase, userId);
  const now = new Date();
  const today = localDate(now, settings.timezone);

  const { data: person } = await supabase
    .from("people")
    .select("notes_md, follow_up_every_days")
    .eq("id", personId)
    .single();

  const update: Record<string, unknown> = { last_contact_at: now.toISOString() };
  if (person?.follow_up_every_days) {
    const next = new Date(now.getTime() + person.follow_up_every_days * 86_400_000);
    update.next_follow_up_at = next.toISOString();
  }
  const trimmed = note?.trim();
  if (trimmed) {
    const line = `- [${today}] ${trimmed}`;
    update.notes_md = person?.notes_md ? `${person.notes_md.trimEnd()}\n${line}` : line;
  }

  const { error } = await supabase.from("people").update(update).eq("id", personId);
  if (error) throw new Error(`logContact: ${error.message}`);
}

/** Set (or clear, with null) the follow-up cadence and recompute next_follow_up_at. */
export async function setFollowUpCadence(personId: string, days: number | null): Promise<void> {
  const { supabase } = await rlsClient();
  const update: Record<string, unknown> = { follow_up_every_days: days };
  if (days === null) {
    update.next_follow_up_at = null;
  } else {
    const { data: person } = await supabase
      .from("people")
      .select("last_contact_at, created_at")
      .eq("id", personId)
      .single();
    const base = new Date(person?.last_contact_at ?? person?.created_at ?? new Date().toISOString());
    update.next_follow_up_at = new Date(base.getTime() + days * 86_400_000).toISOString();
  }
  const { error } = await supabase.from("people").update(update).eq("id", personId);
  if (error) throw new Error(`setFollowUpCadence: ${error.message}`);
}

/**
 * Merge `mergeId` into `keepId` (DESIGN_BRIEF §5.6): tasks, notes, source-item
 * links and suggestion references move across, emails/tags are unioned, notes
 * are concatenated, then the duplicate row is deleted.
 */
export async function mergePeople(keepId: string, mergeId: string): Promise<void> {
  if (keepId === mergeId) return;
  const { supabase, userId } = await rlsClient();

  const { data: rows } = await supabase
    .from("people")
    .select("*")
    .in("id", [keepId, mergeId]);
  const keep = (rows ?? []).find((r) => r.id === keepId) as Person | undefined;
  const merge = (rows ?? []).find((r) => r.id === mergeId) as Person | undefined;
  if (!keep || !merge) throw new Error("mergePeople: person not found.");

  // people_source_items has a unique (person_id, source_item_id, role); drop
  // the duplicate's colliding rows first, then move the rest.
  const { data: keepLinks } = await supabase
    .from("people_source_items")
    .select("source_item_id, role")
    .eq("person_id", keepId);
  const keepKeys = new Set((keepLinks ?? []).map((l) => `${l.source_item_id}:${l.role}`));
  const { data: mergeLinks } = await supabase
    .from("people_source_items")
    .select("id, source_item_id, role")
    .eq("person_id", mergeId);
  const colliding = (mergeLinks ?? [])
    .filter((l) => keepKeys.has(`${l.source_item_id}:${l.role}`))
    .map((l) => l.id);
  if (colliding.length) {
    await supabase.from("people_source_items").delete().in("id", colliding);
  }
  await supabase.from("people_source_items").update({ person_id: keepId }).eq("person_id", mergeId);

  await supabase.from("tasks").update({ person_id: keepId }).eq("person_id", mergeId);
  await supabase.from("notes").update({ person_id: keepId }).eq("person_id", mergeId);

  // suggestions point at a person inside the proposed jsonb.
  const { data: suggestions } = await supabase
    .from("suggestions")
    .select("id, proposed")
    .eq("user_id", userId)
    .filter("proposed->>person_id", "eq", mergeId);
  for (const s of suggestions ?? []) {
    const proposed = { ...(s.proposed as Record<string, unknown>), person_id: keepId };
    await supabase.from("suggestions").update({ proposed }).eq("id", s.id);
  }

  const notes = [keep.notes_md?.trimEnd(), merge.notes_md?.trimEnd()].filter(Boolean).join("\n");
  const { error } = await supabase
    .from("people")
    .update({
      emails: Array.from(new Set([...(keep.emails ?? []), ...(merge.emails ?? [])])),
      tags: Array.from(new Set([...(keep.tags ?? []), ...(merge.tags ?? [])])),
      notes_md: notes || null,
      phone: keep.phone ?? merge.phone,
      company: keep.company ?? merge.company,
      role: keep.role ?? merge.role,
      relationship: keep.relationship ?? merge.relationship,
      domain_id: keep.domain_id ?? merge.domain_id,
      last_contact_at: maxIso(keep.last_contact_at, merge.last_contact_at),
      follow_up_every_days: keep.follow_up_every_days ?? merge.follow_up_every_days,
    })
    .eq("id", keepId);
  if (error) throw new Error(`mergePeople: ${error.message}`);

  await supabase.from("people").delete().eq("id", mergeId);
}

/** People whose follow-up cadence has lapsed (used by /people and dormancy-scan). */
export function isFollowUpOverdue(
  person: Pick<Person, "follow_up_every_days" | "last_contact_at" | "created_at">,
  now: Date,
): boolean {
  if (!person.follow_up_every_days) return false;
  const since = new Date(person.last_contact_at ?? person.created_at).getTime();
  return now.getTime() - since > person.follow_up_every_days * 86_400_000;
}

/** Whole days since the last contact (or since the person was created). */
export function daysSinceContact(
  person: Pick<Person, "last_contact_at" | "created_at">,
  now: Date,
): number {
  const since = new Date(person.last_contact_at ?? person.created_at).getTime();
  return Math.floor((now.getTime() - since) / 86_400_000);
}
