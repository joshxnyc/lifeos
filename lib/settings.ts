import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";

/** Read all settings for a user, filling gaps with defaults. */
export async function getSettings(supabase: SupabaseClient, userId: string): Promise<Settings> {
  const { data } = await supabase.from("settings").select("key, value").eq("user_id", userId);
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of data ?? []) merged[row.key] = row.value;
  return merged as unknown as Settings;
}

export async function setSetting<K extends keyof Settings>(
  supabase: SupabaseClient,
  userId: string,
  key: K,
  value: Settings[K],
): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert({ user_id: userId, key, value }, { onConflict: "user_id,key" });
  if (error) throw new Error(`setSetting ${String(key)}: ${error.message}`);
}
