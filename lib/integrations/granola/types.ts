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

export interface GranolaClient {
  /** Notes created after this ISO timestamp, newest-first or oldest-first. */
  listNotes(createdAfter: string): AsyncIterable<GranolaNote>;
  /** For Settings: which path is live. */
  readonly adapter: "api" | "mcp";
}
