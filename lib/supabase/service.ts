import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Service-role client: bypasses RLS. Jobs and OAuth callbacks only
 * (SPEC §3 Auth). Never import from client components.
 */
export function createServiceClient(): SupabaseClient {
  const { supabaseUrl } = publicEnv();
  return createSupabaseClient(supabaseUrl, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * The single user's id (SPEC: one users row, created via the Supabase
 * dashboard). Jobs run unauthenticated, so they resolve the owner this way.
 *
 * Set OWNER_USER_ID to pin the owner explicitly. Without it, the OLDEST
 * user wins — never the newest, so a stray signup (keep Supabase signups
 * disabled regardless) can't hijack jobs, briefs and calendar writes.
 */
export async function singleUserId(supabase: SupabaseClient): Promise<string> {
  const pinned = process.env.OWNER_USER_ID;
  if (pinned) return pinned;
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 50 });
  if (error || !data.users.length) throw new Error(`No user found: ${error?.message ?? "empty"}`);
  const oldest = [...data.users].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )[0]!;
  return oldest.id;
}
