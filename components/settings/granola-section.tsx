import Link from "next/link";
import { Panel, Row, SettingsSection, StatusPill } from "@/components/settings/ui";
import { RunJobButton } from "@/components/settings/run-job-button";
import type { ConnectedAccount } from "@/lib/types";

/**
 * Granola (SPEC §6.3). Which adapter is live is decided by the environment:
 * a Business-plan API key wins, otherwise MCP OAuth. Open item for Joshua:
 * confirm the plan — Basic gives summaries from the last 30 days and no
 * transcripts; whatever is fetched stays in the archive either way.
 */
export function GranolaSection({
  account,
  hasApiKey,
}: {
  account: ConnectedAccount | null;
  hasApiKey: boolean;
}) {
  const connected = Boolean(account?.access_token_enc) || hasApiKey;

  return (
    <SettingsSection
      title="Granola"
      hint="Meeting notes are copied into the archive so losing Granola access loses nothing historical."
    >
      <Panel>
        <Row
          label="Adapter"
          hint={
            hasApiKey
              ? "API key detected — using the public API adapter, transcripts included."
              : "No API key. Connect over MCP OAuth; Basic plans give summaries from the last 30 days and no transcripts."
          }
        >
          <span className="text-[13px] text-ink-2">{hasApiKey ? "Public API" : "MCP"}</span>
        </Row>

        <Row
          label="Connection"
          hint={
            account?.last_error ? (
              <span className="text-danger">{account.last_error}</span>
            ) : account?.last_synced_at ? (
              `Last sync ${new Date(account.last_synced_at).toLocaleString()}`
            ) : (
              "Not synced yet. Sync now to test the connection."
            )
          }
        >
          {account ? <StatusPill status={account.status} /> : null}
          {connected ? <RunJobButton job="sync-granola" label="Sync now" /> : null}
          {!hasApiKey ? (
            <Link
              href="/api/auth/granola/start"
              prefetch={false}
              className="inline-flex h-11 items-center rounded-card px-2 text-[14px] text-accent"
            >
              {connected ? "Reconnect" : "Connect Granola"}
            </Link>
          ) : null}
        </Row>
      </Panel>
    </SettingsSection>
  );
}
