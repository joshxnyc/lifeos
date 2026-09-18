import Link from "next/link";
import { Panel, Row, SettingsSection, StatusPill } from "@/components/settings/ui";
import { RemoveAccountButton } from "@/components/settings/remove-account-button";
import { EmptyState } from "@/components/ui/empty-state";
import type { ConnectedAccount, Domain } from "@/lib/types";

/**
 * Google accounts (SPEC §6.1). Unlimited by design: adding the third account
 * is this button, not a code change.
 */
export function AccountsSection({
  accounts,
  domains,
  googleConfigured,
}: {
  accounts: ConnectedAccount[];
  domains: Domain[];
  googleConfigured: boolean;
}) {
  const domainName = (id: string | null) => domains.find((d) => d.id === id)?.name ?? "No default";

  return (
    <SettingsSection
      title="Google accounts"
      hint={
        googleConfigured
          ? "Gmail is read-only. Calendar is read plus write to one designated calendar per account."
          : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to connect an account."
      }
      action={
        googleConfigured ? (
          <Link
            href="/api/auth/google/start"
            prefetch={false}
            className="inline-flex h-11 items-center text-[14px] text-accent"
          >
            Connect Google account
          </Link>
        ) : null
      }
    >
      {accounts.length === 0 ? (
        <Panel>
          <div className="px-3">
            <EmptyState line="No Google account connected." />
          </div>
        </Panel>
      ) : (
        <Panel>
          {accounts.map((a) => (
            <Row
              key={a.id}
              label={
                <span className="flex flex-wrap items-center gap-2">
                  {a.label}
                  <StatusPill status={a.status} />
                </span>
              }
              hint={
                <>
                  {a.external_identity} · {domainName(a.default_domain_id)} ·{" "}
                  {a.read_calendar_ids.length} calendar
                  {a.read_calendar_ids.length === 1 ? "" : "s"} read ·{" "}
                  {a.writable_calendar_id ? "writes enabled" : "no writable calendar"}
                  {a.last_error ? (
                    <span className="mt-0.5 block text-danger">{a.last_error}</span>
                  ) : null}
                </>
              }
            >
              <Link
                href={`/settings/accounts/${a.id}`}
                className="inline-flex h-11 items-center rounded-card px-2 text-[14px] text-accent"
              >
                Calendars
              </Link>
              <Link
                href={`/api/auth/google/start?account=${a.id}`}
                prefetch={false}
                className="inline-flex h-11 items-center rounded-card px-2 text-[14px] text-accent"
              >
                Reconnect
              </Link>
              <RemoveAccountButton id={a.id} label={a.label} />
            </Row>
          ))}
        </Panel>
      )}
    </SettingsSection>
  );
}
