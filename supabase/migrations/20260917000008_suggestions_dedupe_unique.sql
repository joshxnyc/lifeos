-- Suggestions were the one synced-into store with no database-level dedupe
-- guarantee: the extraction sweep dedupes by reading recent dedupe_keys and
-- filtering before insert (lib/ai/pipelines/extract.ts), which a concurrent
-- sweep could race. The other stores are already constrained:
--   source_items    unique (provider, external_id)
--   calendar_events unique (account_id, calendar_id, external_id)
--   tasks (mirror)  unique partial index tasks_mirror_origin_idx
--
-- The index is PARTIAL on pending on purpose. Dedupe is windowed by design
-- (a dismissed or expired suggestion may legitimately be re-proposed after
-- DEDUPE_WINDOW_DAYS), so uniqueness may only hold among pending rows. That
-- is sound because pending rows auto-expire after 14 days, inside the 30-day
-- read window — the app-level filter therefore always sees every pending key,
-- and the index only ever fires on a race, which the next hourly sweep heals.

-- Collapse any pre-existing duplicate pending rows (keep the newest) so the
-- unique index can build.
with ranked as (
  select id,
         row_number() over (partition by user_id, dedupe_key order by created_at desc) as rn
  from public.suggestions
  where status = 'pending'
)
update public.suggestions s
set status = 'expired', resolved_at = now()
from ranked r
where s.id = r.id
  and r.rn > 1;

create unique index if not exists suggestions_pending_dedupe_uidx
  on public.suggestions(user_id, dedupe_key)
  where status = 'pending';
