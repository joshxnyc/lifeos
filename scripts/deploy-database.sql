-- LifeOS: full database setup in one paste.
-- Run this ONCE in the Supabase SQL editor (or use 'supabase db push' with the
-- files in /supabase/migrations instead - same content).

-- LifeOS — full schema (SPEC.md §4). Created in Phase 0 so later phases never
-- migrate data. Single user: every table carries user_id with RLS
-- user_id = auth.uid(); server-side jobs use the service role and bypass RLS.

create extension if not exists pgcrypto;
create extension if not exists pg_net;
-- pg_cron lives in the "pg_catalog"/"cron" schema on Supabase; enable it from
-- the dashboard (Database → Extensions) if this errors locally.
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- array_to_string is only STABLE; generated columns need IMMUTABLE.
create or replace function public.immutable_join(arr text[])
returns text language sql immutable as $$ select array_to_string(arr, ' ') $$;

-- ---------------------------------------------------------------------------
-- 4.1 Structure
-- ---------------------------------------------------------------------------

create table public.domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  slug text not null check (slug in ('personal', 'almedia', 'tarifa', 'misc')),
  color text not null,
  sort_order int not null default 0,
  is_placeholder boolean not null default false,
  unique (user_id, slug)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  domain_id uuid not null references public.domains(id) on delete cascade,
  kind text not null default 'project' check (kind in ('project', 'area')),
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'parked', 'done')),
  target_date date,
  last_activity_at timestamptz not null default now(),
  notion_url text,
  sort_order int not null default 0
);
create index projects_domain_idx on public.projects(domain_id);
create index projects_status_idx on public.projects(user_id, status);

-- ---------------------------------------------------------------------------
-- 4.3 Knowledge (people before tasks: tasks reference people)
-- ---------------------------------------------------------------------------

create table public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  emails text[] not null default '{}',
  phone text,
  company text,
  role text,
  domain_id uuid references public.domains(id) on delete set null,
  relationship text,
  notes_md text,
  last_contact_at timestamptz,
  follow_up_every_days int,
  next_follow_up_at timestamptz,
  tags text[] not null default '{}',
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', public.immutable_join(emails)), 'B') ||
    setweight(to_tsvector('english', coalesce(company, '') || ' ' || coalesce(role, '') || ' ' || coalesce(relationship, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(notes_md, '')), 'C')
  ) stored
);
create index people_search_idx on public.people using gin(search_vector);
create index people_last_contact_idx on public.people(user_id, last_contact_at);

-- ---------------------------------------------------------------------------
-- 4.4 Integration layer (accounts + archive before tasks: tasks reference source_items)
-- ---------------------------------------------------------------------------

create table public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider text not null check (provider in ('google', 'notion', 'granola')),
  label text not null,
  external_identity text not null,
  default_domain_id uuid references public.domains(id) on delete set null,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  sync_state jsonb not null default '{}'::jsonb,
  writable_calendar_id text,
  read_calendar_ids text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'needs_reauth', 'disabled')),
  last_synced_at timestamptz,
  last_error text,
  unique (user_id, provider, external_identity)
);

create table public.source_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  account_id uuid references public.connected_accounts(id) on delete set null,
  provider text not null,
  kind text not null check (kind in ('email_thread', 'calendar_event', 'notion_page', 'granola_note')),
  external_id text not null,
  external_url text,
  title text not null default '',
  text text not null default '',
  raw jsonb,
  participants jsonb not null default '[]'::jsonb,
  occurred_at timestamptz,
  fetched_at timestamptz not null default now(),
  content_hash text not null default '',
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'done', 'skipped', 'failed')),
  extracted_at timestamptz,
  domain_id uuid references public.domains(id) on delete set null,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', left(coalesce(text, ''), 100000)), 'C')
  ) stored,
  unique (provider, external_id)
);
create index source_items_search_idx on public.source_items using gin(search_vector);
create index source_items_extraction_idx on public.source_items(user_id, extraction_status, occurred_at desc);
create index source_items_kind_idx on public.source_items(user_id, kind, occurred_at desc);
create index source_items_account_idx on public.source_items(account_id);

create table public.people_source_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  person_id uuid not null references public.people(id) on delete cascade,
  source_item_id uuid not null references public.source_items(id) on delete cascade,
  role text not null check (role in ('from', 'to', 'cc', 'attendee', 'mentioned')),
  unique (person_id, source_item_id, role)
);
create index psi_person_idx on public.people_source_items(person_id);
create index psi_source_idx on public.people_source_items(source_item_id);

-- ---------------------------------------------------------------------------
-- 4.2 Work
-- ---------------------------------------------------------------------------

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  domain_id uuid not null references public.domains(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  title text not null,
  body_md text,
  status text not null default 'open' check (status in ('open', 'done', 'dropped')),
  priority int not null default 0 check (priority between 0 and 3),
  due_date date,
  due_time time,
  scheduled_date date,
  completed_at timestamptz,
  dropped_reason text,
  recurrence_rule text,
  owner text not null default 'me' check (owner in ('me', 'them')),
  origin text not null default 'manual' check (origin in ('manual', 'capture', 'suggestion', 'notion_mirror')),
  origin_id text,
  source_item_id uuid references public.source_items(id) on delete set null,
  calendar_event_id uuid,
  is_mirror boolean not null default false,
  sort_order int not null default 0,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body_md, '')), 'C')
  ) stored,
  constraint them_requires_person check (owner <> 'them' or person_id is not null)
);
create index tasks_search_idx on public.tasks using gin(search_vector);
create index tasks_status_idx on public.tasks(user_id, status, due_date);
create index tasks_domain_idx on public.tasks(domain_id, status);
create index tasks_project_idx on public.tasks(project_id);
create index tasks_person_idx on public.tasks(person_id);
create index tasks_scheduled_idx on public.tasks(user_id, scheduled_date) where status = 'open';
-- one mirror task per Notion page
create unique index tasks_mirror_origin_idx on public.tasks(origin_id) where origin = 'notion_mirror';

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  domain_id uuid references public.domains(id) on delete set null,
  name text not null,
  emoji text,
  schedule_days int[] not null default '{0,1,2,3,4,5,6}',
  reminder_time time,
  grace_minutes int not null default 120,
  nudge_enabled boolean not null default true,
  active boolean not null default true,
  write_to_calendar boolean not null default false,
  calendar_event_external_id text,
  sort_order int not null default 0
);

create table public.routine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  routine_id uuid not null references public.routines(id) on delete cascade,
  date date not null,
  status text not null check (status in ('done', 'missed', 'skipped')),
  completed_at timestamptz,
  unique (routine_id, date)
);
create index routine_logs_date_idx on public.routine_logs(user_id, date desc);

create table public.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  raw_text text,
  audio_path text,
  transcript text,
  cleaned_text text,
  status text not null default 'pending' check (status in ('pending', 'transcribing', 'filing', 'done', 'failed')),
  result jsonb,
  error text,
  source text not null check (source in ('phone_voice', 'phone_text', 'desktop_text', 'desktop_voice'))
);
create index captures_status_idx on public.captures(user_id, status, created_at desc);

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text not null check (kind in ('task', 'deadline_change', 'follow_up', 'person_fact', 'project_update')),
  title text not null,
  detail text,
  proposed jsonb not null default '{}'::jsonb,
  evidence text,
  source_item_id uuid references public.source_items(id) on delete cascade,
  confidence real not null default 0.5 check (confidence >= 0 and confidence <= 1),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed', 'expired')),
  resolved_at timestamptz,
  resulting_task_id uuid references public.tasks(id) on delete set null,
  dedupe_key text not null
);
create index suggestions_status_idx on public.suggestions(user_id, status, created_at desc);
create index suggestions_dedupe_idx on public.suggestions(user_id, dedupe_key, created_at desc);

create table public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  date date not null,
  proposed_top_task_ids uuid[] not null default '{}',
  proposal_reason text,
  chosen_top_task_id uuid references public.tasks(id) on delete set null,
  top3_task_ids uuid[],
  brief_sent_at timestamptz,
  closeout_sent_at timestamptz,
  unique (user_id, date)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null default '',
  body_md text not null default '',
  domain_id uuid references public.domains(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  pinned boolean not null default false,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body_md, '')), 'C')
  ) stored
);
create index notes_search_idx on public.notes using gin(search_vector);
create index notes_project_idx on public.notes(project_id);
create index notes_person_idx on public.notes(person_id);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  account_id uuid not null references public.connected_accounts(id) on delete cascade,
  calendar_id text not null,
  external_id text not null,
  title text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  attendees jsonb not null default '[]'::jsonb,
  location text,
  html_link text,
  task_id uuid references public.tasks(id) on delete set null,
  routine_id uuid references public.routines(id) on delete set null,
  created_by_app boolean not null default false,
  source_item_id uuid references public.source_items(id) on delete set null,
  status text not null default 'confirmed',
  unique (account_id, calendar_id, external_id)
);
create index calendar_events_time_idx on public.calendar_events(user_id, starts_at);

alter table public.tasks
  add constraint tasks_calendar_event_fk
  foreign key (calendar_event_id) references public.calendar_events(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4.5 Notifications and reviews
-- ---------------------------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_label text,
  last_used_at timestamptz,
  failed_count int not null default 0
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text not null check (kind in ('morning_brief', 'routine_reminder', 'routine_missed', 'evening_closeout', 'review_prompt', 'queue_digest', 'follow_up_due', 'needs_reauth', 'sync_failed', 'custom', 'test')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  title text not null,
  body text not null default '',
  url text not null default '/',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'failed', 'cancelled'))
);
create unique index notifications_dedupe_idx
  on public.notifications(kind, scheduled_for, coalesce(payload->>'routine_id', ''));
create index notifications_due_idx on public.notifications(status, scheduled_for) where status = 'scheduled';

create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  week_start date not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'done')),
  step_reached int not null default 1 check (step_reached between 1 and 5),
  scorecard jsonb,
  slipped_decisions jsonb not null default '[]'::jsonb,
  dormant_decisions jsonb not null default '[]'::jsonb,
  week_top3 uuid[],
  coach_text text,
  coach_model text,
  one_change text,
  one_change_accepted boolean,
  completed_at timestamptz,
  unique (user_id, week_start)
);

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  key text not null,
  value jsonb not null,
  unique (user_id, key)
);

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'failed')),
  stats jsonb not null default '{}'::jsonb,
  error text
);
create index job_runs_job_idx on public.job_runs(job, started_at desc);

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  pipeline text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  latency_ms int not null default 0,
  cost_estimate_usd numeric(10, 6) not null default 0,
  ref_id uuid
);
create index ai_calls_month_idx on public.ai_calls(created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers on every table
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security: owner-only on every table
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for capture audio
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('captures', 'captures', false)
on conflict (id) do nothing;

create policy captures_owner_all on storage.objects
  for all to authenticated
  using (bucket_id = 'captures' and owner = auth.uid())
  with check (bucket_id = 'captures' and owner = auth.uid());

-- ---------------------------------------------------------------------------
-- Seed: domains + default settings for each (the single) user, on creation
-- ---------------------------------------------------------------------------

create or replace function public.seed_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.domains (user_id, name, slug, color, sort_order, is_placeholder) values
    (new.id, 'Personal', 'personal', '#7A8C6E', 0, false),
    (new.id, 'Almedia', 'almedia', '#3F5F7A', 1, true),
    (new.id, 'Tarifa', 'tarifa', '#8A5A3C', 2, false),
    (new.id, 'Misc', 'misc', '#7A6C8A', 3, false)
  on conflict (user_id, slug) do nothing;

  insert into public.settings (user_id, key, value) values
    (new.id, 'timezone', '"America/New_York"'),
    (new.id, 'morning_brief_time', '"07:00"'),
    (new.id, 'evening_closeout_time', '"21:00"'),
    (new.id, 'weekly_review_day', '0'),
    (new.id, 'weekly_review_time', '"17:00"'),
    (new.id, 'theme', '"system"'),
    (new.id, 'quiet_hours', '{"start": "23:00", "end": "06:30"}'),
    (new.id, 'extraction_interval_minutes', '60'),
    (new.id, 'extraction_lookback_days_initial', '30'),
    (new.id, 'dormancy_days', '14'),
    (new.id, 'queue_digest_enabled', 'true'),
    (new.id, 'pushover_enabled', 'false')
  on conflict (user_id, key) do nothing;

  return new;
end $$;

create trigger seed_new_user
  after insert on auth.users
  for each row execute function public.seed_new_user();

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

-- L3: capture audio is scoped to its owner's folder.
--
-- The old policy trusted storage.objects.owner, which is whoever uploaded the
-- file — any signed-in user could then read or overwrite any object in the
-- bucket by name. Capture audio now lives at `<user id>/<uuid>.<ext>` and the
-- policy requires the first folder to be the caller's own id. The bucket stays
-- private; the service role (transcription) is unaffected.

drop policy if exists captures_owner_all on storage.objects;

create policy captures_owner_all on storage.objects
  for all to authenticated
  using (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- FINAL STEP - fill in your two values and uncomment before running:
-- app_url = your deployed URL (no trailing slash), jobs_secret = the JOBS_SECRET
-- env var you set in Vercel. The cron jobs read these at call time.
-- ---------------------------------------------------------------------------
-- insert into private.app_config (key, value) values
--   ('app_url', 'https://YOUR-DOMAIN'),
--   ('jobs_secret', 'YOUR_JOBS_SECRET')
-- on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------------------
-- 2026-09-17: task deadline pushes ('task_due' notification kind).
-- Standalone block — safe to paste on its own into the Supabase SQL editor,
-- and safe to run twice (the drop tolerates a missing constraint; the add
-- recreates the same one). Mirrors supabase/migrations/20260917000005_task_due.sql.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('morning_brief', 'routine_reminder', 'routine_missed', 'evening_closeout', 'review_prompt', 'queue_digest', 'follow_up_due', 'needs_reauth', 'sync_failed', 'task_due', 'custom', 'test'));
