import "server-only";
import { serverEnv } from "@/lib/env";
import type { GranolaAttendee, GranolaClient, GranolaNote } from "@/lib/integrations/granola/types";

/**
 * Granola Public API adapter (SPEC §6.3) — Business plan, bearer `grn_` key.
 * GET /notes?created_after=… is cursor paginated; GET /notes/{id}?include=transcript
 * adds the transcript. Rate limit is 5 req/s sustained, so requests are spaced
 * 250ms apart; the sync job is small enough that nothing smarter is needed.
 *
 * Read-only: Granola has no write API and the app would not use one.
 */

const BASE = "https://public-api.granola.ai/v1";
const SPACING_MS = 250;
const MAX_PAGES = 10;

export class GranolaApiClient implements GranolaClient {
  readonly adapter = "api" as const;
  private lastCall = 0;

  constructor(private readonly apiKey = serverEnv().GRANOLA_API_KEY) {
    if (!this.apiKey) throw new Error("GRANOLA_API_KEY is not set");
  }

  async *listNotes(createdAfter: string): AsyncIterable<GranolaNote> {
    let cursor: string | undefined;
    let page = 0;

    do {
      const url = new URL(`${BASE}/notes`);
      url.searchParams.set("created_after", createdAfter);
      url.searchParams.set("limit", "50");
      if (cursor) url.searchParams.set("cursor", cursor);

      const body = await this.get<{
        notes?: RawNote[];
        data?: RawNote[];
        items?: RawNote[];
        next_cursor?: string | null;
        cursor?: string | null;
        has_more?: boolean;
      }>(url.toString());

      const rows = body.notes ?? body.data ?? body.items ?? [];
      for (const raw of rows) {
        const note = mapNote(raw);
        if (!note) continue;
        // Transcripts are a separate fetch and only exist on paid plans; a
        // failure there must not lose the summary.
        if (!note.transcript) {
          try {
            const full = await this.get<RawNote>(
              `${BASE}/notes/${encodeURIComponent(note.id)}?include=transcript`,
            );
            const withTranscript = mapNote(full);
            if (withTranscript?.transcript) note.transcript = withTranscript.transcript;
          } catch {
            // Basic/Business mismatch or a note still processing — ignore.
          }
        }
        yield note;
      }

      cursor = (body.next_cursor ?? body.cursor ?? undefined) || undefined;
      page += 1;
    } while (cursor && page < MAX_PAGES);
  }

  private async get<T>(url: string): Promise<T> {
    const wait = SPACING_MS - (Date.now() - this.lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Granola API ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}

interface RawNote {
  id?: string;
  note_id?: string;
  title?: string;
  name?: string;
  summary?: string;
  ai_summary?: string;
  content?: string;
  notes?: string;
  my_notes?: string;
  user_notes?: string;
  transcript?: string | { text?: string; segments?: Array<{ speaker?: string; text?: string }> };
  attendees?: Array<{ name?: string; email?: string; display_name?: string }>;
  participants?: Array<{ name?: string; email?: string; display_name?: string }>;
  created_at?: string;
  started_at?: string;
  meeting_at?: string;
  url?: string;
  share_url?: string;
}

/** Defensive mapping: the API's exact field names are not contract-stable. */
export function mapNote(raw: RawNote): GranolaNote | null {
  const id = raw.id ?? raw.note_id;
  if (!id) return null;

  const attendees: GranolaAttendee[] = (raw.attendees ?? raw.participants ?? []).map((a) => ({
    name: a.name ?? a.display_name,
    email: a.email,
  }));

  let transcript: string | undefined;
  if (typeof raw.transcript === "string") transcript = raw.transcript;
  else if (raw.transcript?.text) transcript = raw.transcript.text;
  else if (raw.transcript?.segments) {
    transcript = raw.transcript.segments
      .map((s) => [s.speaker, s.text].filter(Boolean).join(": "))
      .join("\n");
  }

  return {
    id,
    title: raw.title ?? raw.name ?? "Untitled meeting",
    summary: raw.summary ?? raw.ai_summary ?? raw.content ?? "",
    myNotes: raw.my_notes ?? raw.user_notes ?? raw.notes,
    transcript,
    attendees,
    occurredAt: raw.started_at ?? raw.meeting_at ?? raw.created_at ?? new Date().toISOString(),
    url: raw.url ?? raw.share_url ?? `https://notes.granola.ai/d/${id}`,
  };
}
