import "server-only";
import { google, type Auth, type calendar_v3 } from "googleapis";
import { fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSettings } from "@/lib/settings";
import { mergeSyncState } from "@/lib/integrations/accounts";
import { errorStatus } from "@/lib/integrations/google/client";
import { upsertSourceItem, type SourceParticipant } from "@/lib/integrations/source-items";
import type { ConnectedAccount } from "@/lib/types";

/**
 * Google Calendar read sync (SPEC §6.1). Every event lands in calendar_events
 * (so Today can draw the day) and in source_items (so it is searchable and
 * extractable). Incremental via syncToken per calendar; a 410 GONE means the
 * token expired and we redo the windowed full sync.
 *
 * This module never writes to Google — see calendar-write.ts for the single
 * place that does, and only to the account's designated writable calendar.
 */

const FULL_SYNC_PAST_DAYS = 30;
const FULL_SYNC_FUTURE_DAYS = 90;
const MAX_PAGES_PER_CALENDAR = 6;

export interface CalendarStats {
  calendars: number;
  events_upserted: number;
  events_deleted: number;
  source_items_changed: number;
  full_syncs: number;
}

export async function syncCalendarsForAccount(opts: {
  supabase: SupabaseClient;
  userId: string;
  account: ConnectedAccount;
  auth: Auth.OAuth2Client;
  deadline: number;
}): Promise<CalendarStats> {
  const { supabase, userId, account, auth, deadline } = opts;
  const cal = google.calendar({ version: "v3", auth });
  const state = (account.sync_state ?? {}) as { calendar_sync_tokens?: Record<string, string> };
  const tokens: Record<string, string> = { ...(state.calendar_sync_tokens ?? {}) };
  // All-day events carry a bare date; it means that day in Joshua's timezone,
  // not UTC — storing it as UTC midnight put them on the previous evening in
  // New York and off Today's local-day window entirely.
  const { timezone } = await getSettings(supabase, userId);

  const stats: CalendarStats = {
    calendars: 0,
    events_upserted: 0,
    events_deleted: 0,
    source_items_changed: 0,
    full_syncs: 0,
  };

  for (const calendarId of account.read_calendar_ids ?? []) {
    if (Date.now() > deadline) break;
    stats.calendars += 1;

    let syncToken: string | undefined = tokens[calendarId];
    let pageToken: string | undefined;
    let pages = 0;
    let retriedAfterGone = false;

    while (pages < MAX_PAGES_PER_CALENDAR && Date.now() < deadline) {
      pages += 1;
      let res;
      try {
        res = await cal.events.list({
          calendarId,
          singleEvents: true,
          showDeleted: true,
          maxResults: 250,
          pageToken,
          ...(syncToken
            ? { syncToken }
            : {
                timeMin: daysFromNow(-FULL_SYNC_PAST_DAYS),
                timeMax: daysFromNow(FULL_SYNC_FUTURE_DAYS),
                orderBy: "startTime",
              }),
        });
      } catch (err) {
        if (errorStatus(err) === 410 && !retriedAfterGone) {
          // Sync token expired: start the windowed full sync again.
          retriedAfterGone = true;
          syncToken = undefined;
          pageToken = undefined;
          delete tokens[calendarId];
          stats.full_syncs += 1;
          continue;
        }
        throw err;
      }

      for (const ev of res.data.items ?? []) {
        const outcome = await upsertEvent({ supabase, userId, account, calendarId, ev, timezone });
        if (outcome === "deleted") stats.events_deleted += 1;
        else {
          stats.events_upserted += 1;
          if (outcome === "changed") stats.source_items_changed += 1;
        }
      }

      pageToken = res.data.nextPageToken ?? undefined;
      if (!pageToken) {
        if (res.data.nextSyncToken) tokens[calendarId] = res.data.nextSyncToken;
        break;
      }
    }
  }

  await mergeSyncState(supabase, account.id, { calendar_sync_tokens: tokens });
  return stats;
}

async function upsertEvent(opts: {
  supabase: SupabaseClient;
  userId: string;
  account: ConnectedAccount;
  calendarId: string;
  ev: calendar_v3.Schema$Event;
  timezone: string;
}): Promise<"created" | "changed" | "unchanged" | "deleted"> {
  const { supabase, userId, account, calendarId, ev, timezone } = opts;
  if (!ev.id) return "unchanged";

  const { data: existing } = await supabase
    .from("calendar_events")
    .select("id, created_by_app, source_item_id, task_id, routine_id")
    .eq("account_id", account.id)
    .eq("calendar_id", calendarId)
    .eq("external_id", ev.id)
    .maybeSingle();

  if (ev.status === "cancelled") {
    if (existing) {
      await supabase.from("calendar_events").delete().eq("id", existing.id);
      return "deleted";
    }
    return "unchanged";
  }

  const allDay = Boolean(ev.start?.date);
  const startsAt = toIso(ev.start, timezone);
  const endsAt = toIso(ev.end, timezone) ?? startsAt;
  if (!startsAt || !endsAt) return "unchanged";

  const attendees = (ev.attendees ?? []).map((a) => ({
    email: a.email ?? undefined,
    displayName: a.displayName ?? undefined,
    responseStatus: a.responseStatus ?? undefined,
  }));

  // Events the app created from a task or routine are not new information —
  // archiving them would feed our own writes back into the extraction sweep.
  let sourceItemId = (existing?.source_item_id as string | null) ?? null;
  let changed = false;
  if (!existing?.created_by_app) {
    const participants: SourceParticipant[] = attendees.map((a) => ({
      name: a.displayName,
      email: a.email,
      role: "attendee",
    }));
    const text = [
      ev.summary ?? "",
      ev.description ?? "",
      attendees.map((a) => [a.displayName, a.email].filter(Boolean).join(" ")).join(", "),
    ]
      .filter(Boolean)
      .join("\n\n");

    const item = await upsertSourceItem(supabase, userId, {
      accountId: account.id,
      provider: "google",
      kind: "calendar_event",
      externalId: `gcal:${account.id}:${calendarId}:${ev.id}`,
      externalUrl: ev.htmlLink ?? null,
      title: ev.summary ?? "(no title)",
      text,
      raw: ev,
      participants,
      occurredAt: startsAt,
      defaultDomainId: account.default_domain_id,
    });
    sourceItemId = item.id;
    changed = item.changed;
  }

  const row = {
    title: ev.summary ?? "",
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: allDay,
    attendees,
    location: ev.location ?? null,
    html_link: ev.htmlLink ?? null,
    status: ev.status ?? "confirmed",
    source_item_id: sourceItemId,
  };

  if (existing) {
    // Never clobber created_by_app / task_id / routine_id from a read sync.
    await supabase.from("calendar_events").update(row).eq("id", existing.id);
    return changed ? "changed" : "unchanged";
  }

  await supabase.from("calendar_events").insert({
    user_id: userId,
    account_id: account.id,
    calendar_id: calendarId,
    external_id: ev.id,
    created_by_app: false,
    ...row,
  });
  return "created";
}

function toIso(when: calendar_v3.Schema$EventDateTime | undefined, timezone: string): string | null {
  if (!when) return null;
  if (when.dateTime) return new Date(when.dateTime).toISOString();
  if (when.date) {
    // A bare date is "that whole day, locally". Google also sends the event's
    // own zone sometimes — prefer it, else Joshua's.
    try {
      return fromZonedTime(`${when.date}T00:00:00`, when.timeZone || timezone).toISOString();
    } catch {
      return new Date(`${when.date}T00:00:00Z`).toISOString();
    }
  }
  return null;
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** The calendars this account can see, for the Settings picker. */
export async function listCalendars(
  auth: Auth.OAuth2Client,
): Promise<Array<{ id: string; summary: string; primary: boolean; accessRole: string }>> {
  const cal = google.calendar({ version: "v3", auth });
  const { data } = await cal.calendarList.list({ maxResults: 250, showHidden: false });
  return (data.items ?? [])
    .filter((c) => Boolean(c.id))
    .map((c) => ({
      id: c.id as string,
      summary: c.summaryOverride ?? c.summary ?? (c.id as string),
      primary: Boolean(c.primary),
      accessRole: c.accessRole ?? "reader",
    }));
}
