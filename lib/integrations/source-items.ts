import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "@/lib/utils";
import { linkParticipantsToPeople } from "@/lib/people";
import type { SourceKind } from "@/lib/types";

/**
 * The archive writer (SPEC §4.4, §2 principle 2: "archive everything the app
 * touches"). Every integration adapter funnels through this one function, so
 * adding a source later means a new provider + adapter + sync job and nothing
 * else (SPEC §6.4).
 */

export interface SourceParticipant {
  name?: string;
  email?: string;
  role: string; // from | to | cc | attendee | mentioned
}

export interface SourceItemInput {
  /** connected_accounts.id, or null for sources without an account row. */
  accountId: string | null;
  provider: string;
  kind: SourceKind;
  /**
   * Globally unique within the provider — source_items has unique
   * (provider, external_id). Adapters namespace it by account so the same
   * thread seen from two Google accounts stays two archive rows.
   */
  externalId: string;
  externalUrl?: string | null;
  title: string;
  text: string;
  raw?: unknown;
  participants?: SourceParticipant[];
  /** ISO timestamp of when the thing happened (not when we fetched it). */
  occurredAt?: string | null;
  /** Explicit domain override; otherwise the account default is used. */
  domainId?: string | null;
  /** The owning account's default_domain_id, passed to avoid a lookup. */
  defaultDomainId?: string | null;
}

export interface UpsertResult {
  id: string;
  /** True when this is new or its content hash moved (⇒ re-extraction). */
  changed: boolean;
}

/** content_hash is over title + text only; `raw` churns without meaning. */
export async function contentHashFor(title: string, text: string): Promise<string> {
  return sha256Hex(`${title}\n${text}`);
}

export async function upsertSourceItem(
  supabase: SupabaseClient,
  userId: string,
  item: SourceItemInput,
): Promise<UpsertResult> {
  const hash = await contentHashFor(item.title, item.text);
  const participants = item.participants ?? [];

  const { data: existing } = await supabase
    .from("source_items")
    .select("id, content_hash, domain_id, extracted_upto:raw->extracted_upto")
    .eq("provider", item.provider)
    .eq("external_id", item.externalId)
    .maybeSingle();

  const domainId =
    item.domainId !== undefined && item.domainId !== null
      ? item.domainId
      : await resolveDefaultDomain(supabase, item);

  let id: string;
  let changed: boolean;

  if (existing) {
    id = existing.id as string;
    changed = existing.content_hash !== hash;
    if (changed) {
      // Re-fetch updates the content and re-opens it for extraction
      // (SPEC §4.4: "resets extraction_status only if content_hash changed").
      const { error } = await supabase
        .from("source_items")
        .update({
          title: item.title,
          text: item.text,
          raw: withExtractedUpto(item.raw ?? null, item.kind, existing.extracted_upto),
          participants,
          occurred_at: item.occurredAt ?? null,
          external_url: item.externalUrl ?? null,
          fetched_at: new Date().toISOString(),
          content_hash: hash,
          extraction_status: "pending",
          extracted_at: null,
          // only fill the domain if it was never set; a manual override wins
          domain_id: existing.domain_id ?? domainId,
        })
        .eq("id", id);
      if (error) throw new Error(`upsertSourceItem update: ${error.message}`);
    } else {
      await supabase.from("source_items").update({ fetched_at: new Date().toISOString() }).eq("id", id);
    }
  } else {
    const { data, error } = await supabase
      .from("source_items")
      .insert({
        user_id: userId,
        account_id: item.accountId,
        provider: item.provider,
        kind: item.kind,
        external_id: item.externalId,
        external_url: item.externalUrl ?? null,
        title: item.title,
        text: item.text,
        raw: item.raw ?? null,
        participants,
        occurred_at: item.occurredAt ?? null,
        fetched_at: new Date().toISOString(),
        content_hash: hash,
        extraction_status: "pending",
        domain_id: domainId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`upsertSourceItem insert: ${error?.message ?? "no row"}`);
    id = data.id as string;
    changed = true;
  }

  // People linking bumps last_contact_at, so it runs only when something
  // actually moved — not on every no-op re-fetch. A failure here must not
  // lose the archived item (the whole point of the archive).
  if (changed && participants.length) {
    try {
      await linkParticipantsToPeople(supabase, userId, id, participants);
    } catch (err) {
      console.error("linkParticipantsToPeople failed", err instanceof Error ? err.message : err);
    }
  }

  return { id, changed };
}

/**
 * Carry the extractor's progress marker across re-fetches. extract.ts records
 * `raw.extracted_upto` on email threads after a successful pass so a new reply
 * only sends the tail to the model; the adapters rebuild `raw` from the
 * provider payload, which would silently drop it here on every update.
 */
function withExtractedUpto(raw: unknown, kind: SourceKind, priorUpto: unknown): unknown {
  if (kind !== "email_thread" || typeof priorUpto !== "number") return raw;
  const base = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
  return { ...base, extracted_upto: priorUpto };
}

async function resolveDefaultDomain(
  supabase: SupabaseClient,
  item: SourceItemInput,
): Promise<string | null> {
  if (item.defaultDomainId !== undefined) return item.defaultDomainId;
  if (!item.accountId) return null;
  const { data } = await supabase
    .from("connected_accounts")
    .select("default_domain_id")
    .eq("id", item.accountId)
    .maybeSingle();
  return (data?.default_domain_id as string | null) ?? null;
}
