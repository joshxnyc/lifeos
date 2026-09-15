import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import { GranolaApiClient } from "@/lib/integrations/granola/granola-api";
import type { GranolaClient } from "@/lib/integrations/granola/types";
import type { ConnectedAccount } from "@/lib/types";

/**
 * Adapter choice (SPEC §6.3): the REST API whenever a Business-plan key is
 * present, otherwise the MCP server once Joshua has connected it. Returns null
 * when neither is available — Granola is optional and its absence is not an
 * error.
 */
export async function getGranolaClient(
  supabase: SupabaseClient,
  userId: string,
): Promise<GranolaClient | null> {
  if (serverEnv().GRANOLA_API_KEY) return new GranolaApiClient();

  const { data } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "granola")
    .maybeSingle();
  const account = data as ConnectedAccount | null;
  if (!account || !account.access_token_enc || account.status === "disabled") return null;

  // Dynamic import keeps the MCP SDK off every other code path.
  const { GranolaMcpClient } = await import("@/lib/integrations/granola/granola-mcp");
  return new GranolaMcpClient(supabase, account);
}

export type { GranolaClient, GranolaNote } from "@/lib/integrations/granola/types";
