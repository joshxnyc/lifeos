-- Security-audit hardening (2026-09-15).

-- L6: private.call_job is SECURITY DEFINER and fires HTTP POSTs carrying
-- JOBS_SECRET; make sure only the cron owner can ever execute it, even if
-- someone later grants USAGE on the private schema.
revoke all on function private.call_job(text) from public;

-- L9: the notification dedupe index was global; scope it per user so a
-- second user (if one ever exists) can't swallow the owner's notifications.
drop index if exists notifications_dedupe_idx;
create unique index notifications_dedupe_idx
  on public.notifications(user_id, kind, scheduled_for, coalesce(payload->>'routine_id', ''));

-- L4: job_runs/ai_calls rows with user_id NULL are invisible under RLS —
-- exactly when Settings most needs to show a failure. Require the owner.
-- (lib/jobs.ts fails loudly instead of writing an orphan row.)
delete from public.job_runs where user_id is null;
delete from public.ai_calls where user_id is null;
alter table public.job_runs alter column user_id set not null;
alter table public.ai_calls alter column user_id set not null;
