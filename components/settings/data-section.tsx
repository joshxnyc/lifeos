"use client";

import { useEffect, useState } from "react";
import { Panel, Row, SettingsSection } from "@/components/settings/ui";

/**
 * Data (SPEC §9): one button that produces a zip of JSON per table plus
 * markdown for the notes, and an honest "storage used" line. This is the
 * antidote to lock-in and what makes "archive everything" real.
 *
 * The export endpoints belong to the capture/export workstream
 * (GET /api/export, GET /api/export/stats); this section links them.
 */
export function DataSection() {
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/export/stats")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`stats ${res.status}`))))
      .then((data) => {
        if (!cancelled) setStats(data as Record<string, unknown>);
      })
      .catch(() => {
        if (!cancelled) setError("Storage size unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byteLines = Object.entries(stats ?? {})
    .filter(([key, value]) => typeof value === "number" && /bytes|size/i.test(key))
    .map(([key, value]) => ({ key, label: humanKey(key), value: formatBytes(value as number) }));

  return (
    <SettingsSection title="Data" hint="Everything the app holds, in open formats, any time.">
      <Panel>
        <Row label="Export" hint="Zip of JSON per table plus markdown for notes.">
          <a
            href="/api/export"
            className="inline-flex h-11 items-center rounded-card bg-accent px-4 text-[14px] font-medium text-white"
          >
            Export
          </a>
        </Row>
        {byteLines.length ? (
          byteLines.map((line) => (
            <Row key={line.key} label={line.label}>
              <span className="tabular text-[14px] text-ink-2">{line.value}</span>
            </Row>
          ))
        ) : (
          <Row label="Storage used" hint={error ?? "Measuring…"} />
        )}
      </Panel>
    </SettingsSection>
  );
}

function humanKey(key: string): string {
  const label = key.replace(/_/g, " ").replace(/bytes/i, "").trim();
  return label ? `${label[0]?.toUpperCase()}${label.slice(1)}` : "Storage used";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1_048_576;
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
