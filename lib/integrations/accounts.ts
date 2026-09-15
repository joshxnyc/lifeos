import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueNotification } from "@/lib/notify";
import type { ConnectedAccount, Provider } from "@/lib/types";

/** Shared connected_accounts helpers used by every adapter and sync job. */

export async function listAccounts(
  supabase: SupabaseClient,
  userId: string,
  provider?: Provider,
  onlyActive = false,
): Promise<ConnectedAccount[]> {
  let q = supabase.from("connected_accounts").select("*").eq("user_id", userId).order("created_at");
  if (provider) q = q.eq("provider", provider);
  if (onlyActive) q = q.eq("status", "active");
  const { data, error } = await q;
  if (error) throw new Error(`listAccounts: ${error.message}`);
  return (data ?? []) as ConnectedAccount[];
}

export async function getAccount(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ConnectedAccount | null> {
  const { data } = await supabase.from("connected_accounts").select("*").eq("id", accountId).maybeSingle();
  return (data as ConnectedAccount | null) ?? null;
}

/** Merge a patch into sync_state without clobbering the other cursors. */
export async function mergeSyncState(
  supabase: SupabaseClient,
  accountId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data } = await supabase
    .from("connected_accounts")
    .select("sync_state")
    .eq("id", accountId)
    .maybeSingle();
  const next = { ...((data?.sync_state as Record<string, unknown>) ?? {}), ...patch };
  const { error } = await supabase
    .from("connected_accounts")
    .update({ sync_state: next })
    .eq("id", accountId);
  if (error) throw new Error(`mergeSyncState: ${error.message}`);
}

export async function setAccountError(
  supabase: SupabaseClient,
  accountId: string,
  message: string | null,
): Promise<void> {
  await supabase
    .from("connected_accounts")
    .update({ last_error: message ? message.slice(0, 1000) : null })
    .eq("id", accountId);
}

export async function markSynced(supabase: SupabaseClient, accountId: string): Promise<void> {
  await supabase
    .from("connected_accounts")
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq("id", accountId);
}

/**
 * SPEC §6.1: an expired/revoked refresh token flips the account to
 * needs_reauth and pushes once per day (the daily dedupe index keys on
 * payload.routine_id, so the account id goes there).
 */
export async function markNeedsReauth(
  supabase: SupabaseClient,
  account: Pick<ConnectedAccount, "id" | "user_id" | "label" | "provider">,
  reason: string,
): Promise<void> {
  await supabase
    .from("connected_accounts")
    .update({ status: "needs_reauth", last_error: reason.slice(0, 1000) })
    .eq("id", account.id);

  await enqueueNotification(supabase, account.user_id, {
    kind: "needs_reauth",
    title: `${account.label} needs to be reconnected`,
    body: `${account.label} stopped syncing. Reconnect it in Settings.`,
    url: "/settings",
    scheduledFor: new Date(),
    payload: { account_id: account.id, routine_id: account.id },
    dedupeDaily: true,
  });
}

/** Human-readable error text for last_error, never including tokens. */
export function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/(access_token|refresh_token|Bearer)\s*[:=]?\s*\S+/gi, "$1 [redacted]").slice(0, 1000);
}
