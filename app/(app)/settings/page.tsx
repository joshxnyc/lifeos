import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { serverEnv } from "@/lib/env";
import { getJsonSetting } from "@/lib/integrations/settings-json";
import { toAccountSummary } from "@/lib/integrations/accounts";
import { getNotionConfig } from "@/lib/integrations/notion/config";
import { googleConfigured } from "@/lib/integrations/google/client";
import { notionConfigured } from "@/lib/integrations/notion/client";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsSection } from "@/components/settings/ui";
import { AccountsSection } from "@/components/settings/accounts-section";
import { NotionSection } from "@/components/settings/notion-section";
import { GranolaSection } from "@/components/settings/granola-section";
import { NotificationsForm } from "@/components/settings/notifications-section";
import { JobsSection } from "@/components/settings/jobs-section";
import { DataSection } from "@/components/settings/data-section";
import { AppearanceSection } from "@/components/settings/appearance-section";
// Owned by the routines & notifications workstream (CONTRACTS): device
// permission + test push, and the recent-notifications list.
import { EnablePushSection } from "@/components/push/enable-push-server";
import { NotificationHistory } from "@/components/routines/notification-history";
import type { NotificationToggles } from "@/lib/integrations/notification-kinds";
import type { AiCall, ConnectedAccount, Domain, JobRun } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Settings (DESIGN_BRIEF §5.10): accounts, notifications, jobs, data, theme. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; granola?: string }>;
}) {
  const { error, granola } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [
    { data: domainRows },
    { data: accountRows },
    { data: jobRows },
    { data: aiRows },
    settings,
    notionConfig,
    toggles,
  ] = await Promise.all([
    supabase.from("domains").select("*").order("sort_order"),
    supabase.from("connected_accounts").select("*").order("created_at"),
    supabase.from("job_runs").select("*").order("started_at", { ascending: false }).limit(200),
    supabase
      .from("ai_calls")
      .select("pipeline, cost_estimate_usd")
      .gte("created_at", monthStart.toISOString()),
    getSettings(supabase, user.id),
    getNotionConfig(supabase, user.id),
    getJsonSetting<NotificationToggles>(supabase, user.id, "notification_kind_toggles", {}),
  ]);

  const domains = (domainRows ?? []) as Domain[];
  // Full rows: read here and by the server sections only. Client components
  // (NotionSection) get toAccountSummary(), never the tokens or sync_state.
  const accounts = (accountRows ?? []) as ConnectedAccount[];
  const googleAccounts = accounts.filter((a) => a.provider === "google");
  const notionAccount = accounts.find((a) => a.provider === "notion") ?? null;
  const granolaAccount = accounts.find((a) => a.provider === "granola") ?? null;

  const spend = summarizeSpend((aiRows ?? []) as Pick<AiCall, "pipeline" | "cost_estimate_usd">[]);
  const env = serverEnv();

  return (
    <>
      <PageHeader title="Settings" />

      {error ? (
        <p className="mb-5 text-[13px] text-danger">Something went wrong: {error}</p>
      ) : null}
      {granola === "connected" ? (
        <p className="mb-5 text-[13px] text-ok">Granola connected.</p>
      ) : null}
      {granola === "api_key_in_use" ? (
        <p className="mb-5 text-[13px] text-ink-2">
          A Granola API key is set, so the API adapter is already in use.
        </p>
      ) : null}

      <AccountsSection
        accounts={googleAccounts}
        domains={domains}
        googleConfigured={googleConfigured()}
      />

      <NotionSection
        configured={notionConfigured()}
        account={notionAccount ? toAccountSummary(notionAccount) : null}
        config={notionConfig}
      />

      <GranolaSection account={granolaAccount} hasApiKey={Boolean(env.GRANOLA_API_KEY)} />

      <SettingsSection title="Notifications">
        <div className="mb-5">
          <EnablePushSection />
        </div>
        <NotificationsForm
          settings={settings}
          toggles={toggles}
          pushoverConfigured={Boolean(env.PUSHOVER_USER_KEY && env.PUSHOVER_APP_TOKEN)}
        />
        <div className="mt-6">
          <NotificationHistory />
        </div>
      </SettingsSection>

      <JobsSection
        runs={(jobRows ?? []) as JobRun[]}
        spend={spend}
        extractionIntervalMinutes={settings.extraction_interval_minutes}
      />

      <DataSection />

      <AppearanceSection theme={settings.theme} timezone={settings.timezone} />
    </>
  );
}

function summarizeSpend(rows: Array<{ pipeline: string; cost_estimate_usd: number | string }>) {
  const byPipeline = new Map<string, { pipeline: string; cost: number; calls: number }>();
  let total = 0;
  for (const row of rows) {
    const cost = Number(row.cost_estimate_usd) || 0;
    total += cost;
    const entry = byPipeline.get(row.pipeline) ?? { pipeline: row.pipeline, cost: 0, calls: 0 };
    entry.cost += cost;
    entry.calls += 1;
    byPipeline.set(row.pipeline, entry);
  }
  return {
    total,
    byPipeline: [...byPipeline.values()].sort((a, b) => b.cost - a.cost),
  };
}
