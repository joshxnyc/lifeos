-- All-day calendar events used to be stored at UTC midnight; toIso now
-- interprets the bare date in the event's (or Joshua's) timezone
-- (lib/integrations/google/calendar.ts). Incremental sync with a stored
-- syncToken never re-delivers unchanged events, so already-stored all-day
-- rows would keep the wrong timestamps forever. Dropping the per-calendar
-- sync tokens forces one windowed full sync, which rewrites starts_at /
-- ends_at for every event under the new interpretation. Safe to run twice:
-- it just forces another full pass.

update public.connected_accounts
set sync_state = sync_state - 'calendar_sync_tokens'
where provider = 'google'
  and sync_state ? 'calendar_sync_tokens';
