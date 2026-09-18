-- Task deadline pushes (SPEC §8): tasks with a due date now enqueue a
-- 'task_due' notification (30 minutes before a timed deadline; 10:00 local the
-- day before for day tasks). notifications.kind was created with an inline
-- CHECK in 20260915000001_init.sql, which Postgres auto-named
-- notifications_kind_check; re-create it with 'task_due' in the list.
-- Plain drop (no `if exists`) on purpose: if the name is ever different, this
-- must fail loudly rather than leave two competing CHECKs on the column.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('morning_brief', 'routine_reminder', 'routine_missed', 'evening_closeout', 'review_prompt', 'queue_digest', 'follow_up_due', 'needs_reauth', 'sync_failed', 'task_due', 'custom', 'test'));
