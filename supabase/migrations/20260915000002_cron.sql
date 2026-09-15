-- pg_cron schedules calling the app's /api/jobs/* route handlers via pg_net
-- (SPEC §3: Vercel Hobby crons are daily-only, so scheduling lives here).
--
-- The app URL and JOBS_SECRET are read at call time from private.app_config,
-- which Joshua populates once after deploy:
--
--   insert into private.app_config (key, value) values
--     ('app_url', 'https://os.example.com'),
--     ('jobs_secret', '<JOBS_SECRET>')
--   on conflict (key) do update set value = excluded.value;

create schema if not exists private;

create table if not exists private.app_config (
  key text primary key,
  value text not null
);
-- Not exposed via the API: no grants to anon/authenticated, RLS locked.
alter table private.app_config enable row level security;

create or replace function private.call_job(job_name text)
returns void
language plpgsql
security definer set search_path = private, net
as $$
declare
  base_url text;
  secret text;
begin
  select value into base_url from private.app_config where key = 'app_url';
  select value into secret from private.app_config where key = 'jobs_secret';
  if base_url is null or secret is null then
    raise notice 'app_config missing app_url/jobs_secret; skipping job %', job_name;
    return;
  end if;
  perform net.http_post(
    url := base_url || '/api/jobs/' || job_name,
    headers := jsonb_build_object('x-jobs-secret', secret, 'content-type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end $$;

-- Schedules (UTC on Supabase; time-of-day jobs re-check local time internally,
-- so they run every 15 min and no-op unless the configured local time matched).
select cron.schedule('lifeos-sync-google',        '*/15 * * * *', $$select private.call_job('sync-google')$$);
select cron.schedule('lifeos-sync-notion',        '*/30 * * * *', $$select private.call_job('sync-notion')$$);
select cron.schedule('lifeos-sync-granola',       '*/30 * * * *', $$select private.call_job('sync-granola')$$);
select cron.schedule('lifeos-extract',            '5 * * * *',    $$select private.call_job('extract')$$);
select cron.schedule('lifeos-process-captures',   '* * * * *',    $$select private.call_job('process-captures')$$);
select cron.schedule('lifeos-notifications-tick', '* * * * *',    $$select private.call_job('notifications-tick')$$);
select cron.schedule('lifeos-routines-nightly',   '*/15 * * * *', $$select private.call_job('routines-nightly')$$);
select cron.schedule('lifeos-plan-morning',       '*/15 * * * *', $$select private.call_job('plan-morning')$$);
select cron.schedule('lifeos-closeout-evening',   '*/15 * * * *', $$select private.call_job('closeout-evening')$$);
select cron.schedule('lifeos-review-prompt',      '*/15 * * * *', $$select private.call_job('review-prompt')$$);
select cron.schedule('lifeos-dormancy-scan',      '30 10 * * *',  $$select private.call_job('dormancy-scan')$$);
select cron.schedule('lifeos-schedule-day',       '*/15 * * * *', $$select private.call_job('schedule-day')$$);
