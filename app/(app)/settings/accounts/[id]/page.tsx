import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/settings/ui";
import { AccountForm } from "@/components/settings/account-form";
import { getGoogleClientForAccount } from "@/lib/integrations/google/client";
import { listCalendars } from "@/lib/integrations/google/calendar";
import { safeErrorMessage } from "@/lib/integrations/accounts";
import type { CalendarOption } from "@/app/(app)/settings/actions";
import type { ConnectedAccount, Domain } from "@/lib/types";

export default async function AccountSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connected?: string }>;
}) {
  const { id } = await params;
  const { connected } = await searchParams;
  const supabase = await createClient();

  const [{ data: accountRow }, { data: domainRows }] = await Promise.all([
    supabase.from("connected_accounts").select("*").eq("id", id).maybeSingle(),
    supabase.from("domains").select("*").order("sort_order"),
  ]);

  const account = accountRow as ConnectedAccount | null;
  if (!account) notFound();
  const domains = (domainRows ?? []) as Domain[];

  // Live calendar list, but only when the account can actually talk to Google.
  let calendars: CalendarOption[] = [];
  let calendarError: string | null = account.last_error;
  if (account.provider === "google" && account.status === "active") {
    try {
      const auth = await getGoogleClientForAccount(supabase, account);
      calendars = await listCalendars(auth);
      calendarError = null;
    } catch (err) {
      calendarError = safeErrorMessage(err);
    }
  }

  return (
    <>
      <PageHeader
        title={account.label}
        subtitle={
          <span className="flex items-center gap-2">
            {account.external_identity} <StatusPill status={account.status} />
          </span>
        }
        actions={
          <Link href="/settings" className="text-[14px] text-accent">
            Settings
          </Link>
        }
      />

      {connected ? (
        <p className="mb-5 rounded-card border border-line bg-accent-soft px-3 py-2 text-[13px] text-ink">
          Connected. Pick a default domain and the calendars to use.
        </p>
      ) : null}

      {account.status === "needs_reauth" ? (
        <p className="mb-5 text-[13px] text-danger">
          This account stopped syncing.{" "}
          <Link href="/api/auth/google/start" prefetch={false} className="text-accent">
            Reconnect →
          </Link>
        </p>
      ) : null}

      <AccountForm
        account={account}
        domains={domains}
        calendars={calendars}
        calendarError={calendarError}
      />
    </>
  );
}
