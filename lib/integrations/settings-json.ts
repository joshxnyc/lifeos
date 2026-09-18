import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * settings is a key/value jsonb table (SPEC §4.5). lib/settings.ts is typed to
 * the documented keys; integration-owned keys that the spec left open live
 * here so the kernel type stays honest. Keys used:
 *
 *   notion_config              — SPEC §6.2 database mapping (see notion/config.ts)
 *   notification_kind_toggles  — per-kind push on/off (Settings → Notifications)
 */
export async function getJsonSetting<T>(
  supabase: SupabaseClient,
  userId: string,
  key: string,
  fallback: T,
): Promise<T> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();
  if (!data || data.value === null || data.value === undefined) return fallback;
  return data.value as T;
}

export async function setJsonSetting(
  supabase: SupabaseClient,
  userId: string,
  key: string,
  value: unknown,
): Promise<void> {
  const { error } = await supabase
    .from("settings")
    .upsert({ user_id: userId, key, value }, { onConflict: "user_id,key" });
  if (error) throw new Error(`setJsonSetting ${key}: ${error.message}`);
}
