import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getJsonSetting, setJsonSetting } from "@/lib/integrations/settings-json";

/**
 * SPEC §6.2: Joshua marks which shared databases are "task-like" and maps
 * which property is the title / status / due / assignee, plus which status
 * values mean done. Stored in settings under `notion_config` because it is
 * configuration, not data.
 */

export const NotionDatabaseMap = z.object({
  title: z.string().default(""),
  status: z.string().default(""),
  due: z.string().default(""),
  assignee: z.string().default(""),
  doneValues: z.array(z.string()).default([]),
});

export const NotionDatabaseConfig = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  taskLike: z.boolean().default(false),
  map: NotionDatabaseMap.default({ title: "", status: "", due: "", assignee: "", doneValues: [] }),
});

export const NotionConfig = z.object({
  databases: z.array(NotionDatabaseConfig).default([]),
});

export type NotionConfig = z.infer<typeof NotionConfig>;
export type NotionDatabaseConfig = z.infer<typeof NotionDatabaseConfig>;

export const EMPTY_NOTION_CONFIG: NotionConfig = { databases: [] };

export async function getNotionConfig(
  supabase: SupabaseClient,
  userId: string,
): Promise<NotionConfig> {
  const raw = await getJsonSetting<unknown>(supabase, userId, "notion_config", EMPTY_NOTION_CONFIG);
  const parsed = NotionConfig.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_NOTION_CONFIG;
}

export async function setNotionConfig(
  supabase: SupabaseClient,
  userId: string,
  config: NotionConfig,
): Promise<void> {
  await setJsonSetting(supabase, userId, "notion_config", NotionConfig.parse(config));
}
