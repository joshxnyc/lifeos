"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { setSetting } from "@/lib/settings";
import { getJsonSetting, setJsonSetting } from "@/lib/integrations/settings-json";
import { setNotionConfig, NotionConfig } from "@/lib/integrations/notion/config";
import { ensureNotionAccount } from "@/lib/integrations/notion/sync";
import {
  getWorkspaceName,
  listDatabases,
  notionConfigured,
  searchShared,
  type NotionDatabaseInfo,
} from "@/lib/integrations/notion/client";
import { getGoogleClientForAccount } from "@/lib/integrations/google/client";
import { listCalendars } from "@/lib/integrations/google/calendar";
import { safeErrorMessage } from "@/lib/integrations/accounts";
import {
  NOTIFICATION_KINDS,
  type NotificationToggles,
} from "@/lib/integrations/notification-kinds";
import type { ConnectedAccount } from "@/lib/types";

/**
 * Settings mutations (SPEC §9, DESIGN_BRIEF §5.10). Everything is a server
 * action, zod-validated, on the RLS client — no service-role writes from a
 * user-facing screen.
 */

async function userScope() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, userId: user.id };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const AccountPatch = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  defaultDomainId: z.string().uuid().nullable(),
  readCalendarIds: z.array(z.string().min(1)).max(50),
  writableCalendarId: z.string().min(1).nullable(),
});

export async function updateAccount(input: z.infer<typeof AccountPatch>): Promise<ActionResult> {
  const parsed = AccountPatch.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Those settings didn't validate" };
  const { supabase } = await userScope();

  const { error } = await supabase
    .from("connected_accounts")
    .update({
      label: parsed.data.label,
      default_domain_id: parsed.data.defaultDomainId,
      read_calendar_ids: parsed.data.readCalendarIds,
      writable_calendar_id: parsed.data.writableCalendarId,
    })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  revalidatePath(`/settings/accounts/${parsed.data.id}`);
  return { ok: true };
}

const AccountId = z.object({ id: z.string().uuid() });

/**
 * Removing an account deletes the row only. The archive stays: source_items
 * .account_id is ON DELETE SET NULL, so every email, meeting and page the app
 * ever read remains searchable (SPEC §2 principle 2).
 */
export async function removeAccount(input: z.infer<typeof AccountId>): Promise<ActionResult> {
  const parsed = AccountId.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown account" };
  const { supabase } = await userScope();

  const { error } = await supabase.from("connected_accounts").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

const AccountStatusPatch = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "disabled"]),
});

export async function setAccountStatus(
  input: z.infer<typeof AccountStatusPatch>,
): Promise<ActionResult> {
  const parsed = AccountStatusPatch.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown account" };
  const { supabase } = await userScope();
  const { error } = await supabase
    .from("connected_accounts")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export interface CalendarOption {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

/** Live calendar list for the per-account setup page. */
export async function fetchCalendars(
  accountId: string,
): Promise<{ ok: true; calendars: CalendarOption[] } | { ok: false; error: string }> {
  const parsed = z.string().uuid().safeParse(accountId);
  if (!parsed.success) return { ok: false, error: "Unknown account" };
  const { supabase } = await userScope();

  const { data } = await supabase
    .from("connected_accounts")
    .select("*")
    .eq("id", parsed.data)
    .maybeSingle();
  const account = data as ConnectedAccount | null;
  if (!account) return { ok: false, error: "Account not found" };

  try {
    const auth = await getGoogleClientForAccount(supabase, account);
    return { ok: true, calendars: await listCalendars(auth) };
  } catch (err) {
    return { ok: false, error: safeErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Notion
// ---------------------------------------------------------------------------

export interface NotionVisibility {
  workspace: string;
  databases: NotionDatabaseInfo[];
  pages: Array<{ id: string; title: string; url: string }>;
}

/**
 * "Refresh available databases": shows exactly what the integration can see.
 * If something is missing, it has not been shared with the integration from
 * Notion's own UI — the app cannot grant itself access.
 */
export async function refreshNotionVisibility(): Promise<
  { ok: true; data: NotionVisibility } | { ok: false; error: string }
> {
  if (!notionConfigured()) return { ok: false, error: "NOTION_TOKEN is not set" };
  const { supabase, userId } = await userScope();

  try {
    const [workspace, databases, pages] = await Promise.all([
      getWorkspaceName(),
      listDatabases(),
      searchShared({ objectType: "page", limit: 25 }),
    ]);
    await ensureNotionAccount(supabase, userId, workspace);
    revalidatePath("/settings");
    return {
      ok: true,
      data: {
        workspace,
        databases,
        pages: pages.map((p) => ({ id: p.id, title: p.title, url: p.url })),
      },
    };
  } catch (err) {
    return { ok: false, error: safeErrorMessage(err) };
  }
}

export async function saveNotionConfig(input: unknown): Promise<ActionResult> {
  const parsed = NotionConfig.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That mapping didn't validate" };
  const { supabase, userId } = await userScope();
  await setNotionConfig(supabase, userId, parsed.data);
  revalidatePath("/settings");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const HHmm = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm");

const NotificationSettings = z.object({
  morning_brief_time: HHmm,
  evening_closeout_time: HHmm,
  weekly_review_day: z.number().int().min(0).max(6),
  weekly_review_time: HHmm,
  quiet_start: HHmm,
  quiet_end: HHmm,
  queue_digest_enabled: z.boolean(),
  pushover_enabled: z.boolean(),
});

export async function saveNotificationSettings(
  input: z.infer<typeof NotificationSettings>,
): Promise<ActionResult> {
  const parsed = NotificationSettings.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { supabase, userId } = await userScope();
  const v = parsed.data;

  await Promise.all([
    setSetting(supabase, userId, "morning_brief_time", v.morning_brief_time),
    setSetting(supabase, userId, "evening_closeout_time", v.evening_closeout_time),
    setSetting(supabase, userId, "weekly_review_day", v.weekly_review_day),
    setSetting(supabase, userId, "weekly_review_time", v.weekly_review_time),
    setSetting(supabase, userId, "quiet_hours", { start: v.quiet_start, end: v.quiet_end }),
    setSetting(supabase, userId, "queue_digest_enabled", v.queue_digest_enabled),
    setSetting(supabase, userId, "pushover_enabled", v.pushover_enabled),
  ]);

  revalidatePath("/settings");
  return { ok: true };
}

const Toggles = z.record(z.string(), z.boolean());

/**
 * Per-kind on/off, stored under `notification_kind_toggles`. notifications-tick
 * (A3) reads this map before sending and drops a kind that is switched off; a
 * missing key means on.
 */
export async function saveNotificationToggles(input: unknown): Promise<ActionResult> {
  const parsed = Toggles.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid toggles" };
  const { supabase, userId } = await userScope();
  const clean: Record<string, boolean> = {};
  for (const kind of NOTIFICATION_KINDS) {
    const value = parsed.data[kind];
    if (typeof value === "boolean") clean[kind] = value;
  }
  await setJsonSetting(supabase, userId, "notification_kind_toggles", clean);
  revalidatePath("/settings");
  return { ok: true };
}

export async function getNotificationToggles(): Promise<NotificationToggles> {
  const { supabase, userId } = await userScope();
  return getJsonSetting<NotificationToggles>(supabase, userId, "notification_kind_toggles", {});
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

const Theme = z.object({ theme: z.enum(["system", "light", "dark"]) });

export async function saveTheme(input: z.infer<typeof Theme>): Promise<ActionResult> {
  const parsed = Theme.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown theme" };
  const { supabase, userId } = await userScope();
  await setSetting(supabase, userId, "theme", parsed.data.theme);
  revalidatePath("/settings");
  return { ok: true };
}
