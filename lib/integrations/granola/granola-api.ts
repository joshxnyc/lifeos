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
      if (cursor) url.searchParams.set("cursor", cursor);

      const body = await this.get<{
        notes?: RawNote[];
        data?: RawNote[];
        items?: RawNote[];
        next_cursor?: string | null;
        cursor?: string | null;
        hasMore?: boolean;
        has_more?: boolean;
      }>(url.toString());

      const rows = body.notes ?? body.data ?? body.items ?? [];
      for (const raw of rows) {
        const note = mapNote(raw);
        if (!note) continue;
        // Transcripts are a separate fetch; a failure there must not lose the
        // summary. An oversized transcript comes back 413 with a dedicated
        // endpoint (docs.granola.ai) — fall through to it.
        if (!note.transcript) {
          try {
            const full = await this.get<RawNote>(
              `${BASE}/notes/${encodeURIComponent(note.id)}?include=transcript`,
            );
            const withTranscript = mapNote(full);
            if (withTranscript?.transcript) note.transcript = withTranscript.transcript;
          } catch (err) {
            if (err instanceof Error && err.message.includes("413")) {
              note.transcript = await this.fetchLargeTranscript(note.id);
            }
            // Anything else: a note still processing or scope-limited — keep
            // the summary and move on.
          }
        }
        yield note;
      }

      const more = body.hasMore ?? body.has_more;
      cursor =
        more === false ? undefined : (body.next_cursor ?? body.cursor ?? undefined) || undefined;
      page += 1;
    } while (cursor && page < MAX_PAGES);
  }

  /** GET /notes/{id}/transcript — the fallback for 413 TRANSCRIPT_TOO_LARGE. */
  private async fetchLargeTranscript(noteId: string): Promise<string | undefined> {
    try {
      const body = await this.get<{ transcript?: RawNote["transcript"] }>(
        `${BASE}/notes/${encodeURIComponent(noteId)}/transcript`,
      );
      return flattenTranscript(body.transcript);
    } catch {
      return undefined;
    }
  }

  private async get<T>(url: string): Promise<T> {
    const wait = SPACING_MS - (Date.now() - this.lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      // Plain-language, because this lands verbatim in Settings → Granola.
      throw new Error(
        `Granola rejected the API key (${res.status}). Create a key in Granola → Settings → Connectors → API keys (Business plan, "Personal notes" scope), update GRANOLA_API_KEY in Vercel, and redeploy.`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Granola API ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}

/**
 * A transcript segment's speaker varies by platform: a plain string, or an
 * object (macOS carries speaker.source, iOS a diarization_label).
 */
interface RawSegment {
  speaker?: string | { name?: string; label?: string; source?: string; diarization_label?: string };
  diarization_label?: string;
  text?: string;
}

type RawTranscript = string | RawSegment[] | { text?: string; segments?: RawSegment[] };

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
  transcript?: RawTranscript;
  attendees?: Array<{ name?: string; email?: string; display_name?: string }>;
  participants?: Array<{ name?: string; email?: string; display_name?: string }>;
  created_at?: string;
  started_at?: string;
  meeting_at?: string;
  url?: string;
  share_url?: string;
}

/** One line per segment, "Speaker: text", tolerating every observed shape. */
export function flattenTranscript(raw: RawTranscript | undefined): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return raw || undefined;
  const segments = Array.isArray(raw) ? raw : (raw.segments ?? undefined);
  if (!segments) {
    return Array.isArray(raw) ? undefined : raw.text || undefined;
  }
  const lines = segments
    .map((s) => {
      const speaker =
        typeof s.speaker === "string"
          ? s.speaker
          : (s.speaker?.name ?? s.speaker?.label ?? s.speaker?.diarization_label ?? s.speaker?.source ?? s.diarization_label);
      return [speaker, s.text].filter(Boolean).join(": ");
    })
    .filter(Boolean);
  return lines.length ? lines.join("\n") : undefined;
}

/** Defensive mapping: the API's exact field names are not contract-stable. */
export function mapNote(raw: RawNote): GranolaNote | null {
  const id = raw.id ?? raw.note_id;
  if (!id) return null;

  const attendees: GranolaAttendee[] = (raw.attendees ?? raw.participants ?? []).map((a) => ({
    name: a.name ?? a.display_name,
    email: a.email,
  }));

  const transcript = flattenTranscript(raw.transcript);

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
