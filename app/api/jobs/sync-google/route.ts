import { jobRoute } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { listAccounts, markSynced, setAccountError, safeErrorMessage } from "@/lib/integrations/accounts";
import { getGoogleClientForAccount, isInvalidGrant } from "@/lib/integrations/google/client";
import { syncGmailForAccount } from "@/lib/integrations/google/gmail";
import { syncCalendarsForAccount } from "@/lib/integrations/google/calendar";

/**
 * Every 15 minutes: Gmail history + Calendar incremental sync for every active
 * Google account (SPEC §5, §6.1). Idempotent, cursor-driven, and budgeted:
 * each account gets a slice of a 50s wall-clock budget and whatever it does
 * not finish continues on the next tick.
 */
const TOTAL_BUDGET_MS = 50_000;

export const maxDuration = 60;

export const POST = jobRoute("sync-google", async ({ supabase, userId }) => {
  const started = Date.now();
  const settings = await getSettings(supabase, userId);
  const accounts = await listAccounts(supabase, userId, "google", true);

  const perAccount: Record<string, unknown> = {};
  let errors = 0;

  for (const [index, account] of accounts.entries()) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    if (remaining < 5_000) break;
    const share = Math.max(5_000, Math.floor(remaining / (accounts.length - index)));
    const deadline = Date.now() + share;

    try {
      const auth = await getGoogleClientForAccount(supabase, account);

      const gmail = await syncGmailForAccount({
        supabase,
        userId,
        account,
        auth,
        lookbackDays: settings.extraction_lookback_days_initial,
        deadline: Math.min(deadline, started + TOTAL_BUDGET_MS),
      });

      const calendar = await syncCalendarsForAccount({
        supabase,
        userId,
        account,
        auth,
        deadline: Math.min(deadline, started + TOTAL_BUDGET_MS),
      });

      await markSynced(supabase, account.id);
      perAccount[account.label] = { gmail, calendar };
    } catch (err) {
      errors += 1;
      const message = safeErrorMessage(err);
      // getGoogleClientForAccount already flipped the account to needs_reauth
      // and pushed once; here we only record what happened.
      await setAccountError(supabase, account.id, message);
      perAccount[account.label] = { error: message, needs_reauth: isInvalidGrant(err) };
    }
  }

  // If every account failed, fail the job so job_runs shows red and a repeat
  // failure raises the sync_failed push (SPEC §11).
  if (accounts.length > 0 && errors === accounts.length) {
    throw new Error(`All ${accounts.length} Google account(s) failed to sync`);
  }

  return { accounts: accounts.length, errors, per_account: perAccount, ms: Date.now() - started };
});
