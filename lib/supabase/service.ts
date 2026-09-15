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
 */
export async function singleUserId(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error || !data.users[0]) throw new Error(`No user found: ${error?.message ?? "empty"}`);
  return data.users[0].id;
}
