import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapNote } from "@/lib/integrations/granola/granola-api";
import { GRANOLA_MCP_URL, GranolaOAuthProvider } from "@/lib/integrations/granola/oauth-provider";
import type {
  GranolaClient,
  GranolaListResult,
  GranolaNote,
} from "@/lib/integrations/granola/types";
import type { ConnectedAccount } from "@/lib/types";

/**
 * Granola MCP adapter (SPEC §6.3) — works on every plan; Basic exposes the
 * last 30 days of summaries and no transcripts, so transcript calls are
 * expected to fail there and are tolerated.
 *
 * The MCP SDK is imported dynamically: nothing outside this file depends on
 * it, and a broken MCP path must degrade to "Granola didn't sync" rather than
 * take down the job or the build.
 */

const TOOL_LIST = ["list_meetings", "query_granola_meetings", "get_meetings"];
const TOOL_TRANSCRIPT = "get_meeting_transcript";

export class GranolaMcpClient implements GranolaClient {
  readonly adapter = "mcp" as const;
  /** One lazy connection shared by listNotes and fetchTranscript; the caller
   *  releases it with close() when the run is over. */
  private conn: Promise<McpLike> | null = null;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly account: ConnectedAccount,
  ) {}

  async *listNotes(createdAfter: string): AsyncGenerator<GranolaNote, GranolaListResult, void> {
    const client = await this.client();
    const raw = await this.firstWorkingTool(client, TOOL_LIST, [
      { limit: 50 },
      { limit: 50, created_after: createdAfter },
      {},
    ]);
    const notes = toNotes(raw);

    for (const note of notes) {
      if (note.occurredAt && note.occurredAt < createdAfter) continue;
      yield note;
    }

    // MCP has no pagination: one batch is everything reachable this run.
    // Reporting it as exhaustive lets the sync cursor advance through the
    // batch — pinning the cursor instead would refetch the same batch forever
    // without ever reaching anything the tool's own cap withheld.
    return { exhausted: true };
  }

  /** Paid-plan only — Basic returns an error here, which is fine. */
  async fetchTranscript(note: GranolaNote): Promise<string | undefined> {
    try {
      const client = await this.client();
      const transcript = await callTool(client, TOOL_TRANSCRIPT, { meeting_id: note.id });
      return transcriptText(transcript) || undefined;
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    const conn = this.conn;
    this.conn = null;
    if (!conn) return;
    try {
      const client = await conn;
      await (client as { close?: () => Promise<void> }).close?.();
    } catch {
      /* closing a dead transport is not an error worth surfacing */
    }
  }

  private client(): Promise<McpLike> {
    if (!this.conn) this.conn = this.connect();
    return this.conn;
  }

  private async connect(): Promise<McpLike> {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );

    const provider = new GranolaOAuthProvider(this.supabase, this.account, () => {
      throw new Error("Granola needs to be reconnected");
    });

    const transport = new StreamableHTTPClientTransport(new URL(GRANOLA_MCP_URL), {
      authProvider: provider,
    });
    const client = new Client({ name: "lifeos", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    return client;
  }

  /** Granola's tool names and argument shapes vary by plan; try in order. */
  private async firstWorkingTool(
    client: McpLike,
    names: string[],
    argSets: Array<Record<string, unknown>>,
  ): Promise<unknown> {
    let lastError: unknown;
    for (const name of names) {
      for (const args of argSets) {
        try {
          return await callTool(client, name, args);
        } catch (err) {
          lastError = err;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("No Granola MCP tool responded");
  }
}

interface McpLike {
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
}

async function callTool(
  client: McpLike,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return client.callTool({ name, arguments: args });
}

/** MCP results carry text content and sometimes structuredContent. */
function resultPayload(result: unknown): unknown {
  const r = result as {
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  if (r?.isError) throw new Error(textOf(r.content) || "Granola MCP tool returned an error");
  if (r?.structuredContent) return r.structuredContent;
  const text = textOf(r?.content);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function textOf(content: Array<{ type?: string; text?: string }> | undefined): string {
  return (content ?? [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n")
    .trim();
}

function toNotes(result: unknown): GranolaNote[] {
  const payload = resultPayload(result);
  const rows = Array.isArray(payload)
    ? payload
    : ((payload as { meetings?: unknown[]; notes?: unknown[]; results?: unknown[] })?.meetings ??
      (payload as { notes?: unknown[] })?.notes ??
      (payload as { results?: unknown[] })?.results ??
      []);
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => mapNote(row as Parameters<typeof mapNote>[0]))
    .filter((n): n is GranolaNote => Boolean(n));
}

function transcriptText(result: unknown): string {
  const payload = resultPayload(result);
  if (typeof payload === "string") return payload;
  const p = payload as {
    transcript?: string | { text?: string };
    segments?: Array<{ speaker?: string; text?: string }>;
    text?: string;
  } | null;
  if (!p) return "";
  if (typeof p.transcript === "string") return p.transcript;
  if (p.transcript?.text) return p.transcript.text;
  if (p.text) return p.text;
  if (Array.isArray(p.segments)) {
    return p.segments.map((s) => [s.speaker, s.text].filter(Boolean).join(": ")).join("\n");
  }
  return "";
}
