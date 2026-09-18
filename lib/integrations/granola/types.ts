import "server-only";

/**
 * SPEC §6.3. Granola has two access paths and Joshua's plan decides which one
 * works: the MCP server (all plans, summaries only on Basic, 30-day window) or
 * the public REST API (Business plan, transcripts included). Both adapters
 * produce the same GranolaNote, so the sync job and everything downstream is
 * plan-agnostic — and once a note is fetched it lives in our archive forever,
 * even if the plan changes or access is lost.
 */

export interface GranolaAttendee {
  name?: string;
  email?: string;
}

export interface GranolaNote {
  id: string;
  title: string;
  summary: string;
  /** Joshua's own typed notes from the meeting, when the source exposes them. */
  myNotes?: string;
  /** Full transcript — paid plans only; absent on Basic. */
  transcript?: string;
  attendees: GranolaAttendee[];
  /** ISO timestamp of the meeting. */
  occurredAt: string;
  url: string;
}

export interface GranolaListResult {
  /**
   * True when the source had nothing more after what was yielded — false when
   * the walk stopped at a page cap. The sync job may only advance its cursor
   * past unprocessed notes when the listing was exhaustive.
   */
  exhausted: boolean;
}

export interface GranolaClient {
  /**
   * Note headers created after this ISO timestamp: summary, attendees, and a
   * transcript only when the listing already carried one. Transcripts are
   * hydrated separately via fetchTranscript so the sync job can list a large
   * backlog cheaply and only pay for the notes it processes this run. The
   * yield order is NOT contract-stable — the caller buffers and sorts.
   */
  listNotes(createdAfter: string): AsyncGenerator<GranolaNote, GranolaListResult, void>;
  /** Best-effort transcript for one note; undefined when unavailable. */
  fetchTranscript(note: GranolaNote): Promise<string | undefined>;
  /** Release any underlying connection. Safe to call repeatedly. */
  close(): Promise<void>;
  /** For Settings: which path is live. */
  readonly adapter: "api" | "mcp";
}
