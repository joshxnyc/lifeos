"use client";

import { useEffect, useState } from "react";
import { Panel, Row, SettingsSection } from "@/components/settings/ui";

/**
 * Data (SPEC §9): one button that produces a zip of JSON per table plus
 * markdown for the notes, and an honest "storage used" line. This is the
 * antidote to lock-in and what makes "archive everything" real.
 *
 * The export endpoints belong to the capture/export workstream
 * (GET /api/export, GET /api/export/stats); this section links them. The
 * Postgres size is not exposed by Supabase's REST API, so the line covers the
 * audio bucket and the row counts that matter.
 */
interface ExportStats {
  audio?: { files?: number; bytes?: number; label?: string };
  captures?: number;
  archived_items?: number;
  [key: string]: unknown;
}

export function DataSection() {
  const [stats, setStats] = useState<ExportStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/export/stats")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`stats ${res.status}`))))
      .then((data) => {
        if (!cancelled) setStats(data as ExportStats);
      })
      .catch(() => {
        if (!cancelled) setError("Storage size unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const audio = stats?.audio;

  return (
    <SettingsSection title="Data" hint="Everything the app holds, in open formats, any time.">
      <Panel>
        <Row label="Export" hint="Zip of JSON per table plus markdown for notes.">
          <a
            href="/api/export"
            className="inline-flex h-11 items-center rounded-full bg-accent px-4 text-[14px] font-medium text-paper"
          >
            Export
          </a>
        </Row>

        {stats ? (
          <>
            <Row
              label="Capture audio"
              hint={`${audio?.files ?? 0} file${audio?.files === 1 ? "" : "s"}`}
            >
              <span className="tabular text-[14px] text-ink-2">
                {audio?.label ?? formatBytes(audio?.bytes ?? 0)}
              </span>
            </Row>
            <Row label="Captures">
              <span className="tabular text-[14px] text-ink-2">{stats.captures ?? 0}</span>
            </Row>
            <Row label="Archived items" hint="Emails, meetings, calendar events and Notion pages.">
              <span className="tabular text-[14px] text-ink-2">{stats.archived_items ?? 0}</span>
            </Row>
          </>
        ) : (
          <Row label="Storage used" hint={error ?? "Measuring…"} />
        )}
      </Panel>
    </SettingsSection>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const mb = bytes / 1_048_576;
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
