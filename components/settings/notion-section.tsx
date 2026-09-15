"use client";

import { useState, useTransition } from "react";
import { refreshNotionVisibility, saveNotionConfig } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Mono, Panel, Row, SettingsSection, selectClass } from "@/components/settings/ui";
import type { NotionConfig, NotionDatabaseConfig } from "@/lib/integrations/notion/config";
import type { NotionDatabaseInfo } from "@/lib/integrations/notion/client";
import type { ConnectedAccount } from "@/lib/types";

/**
 * Notion (Tarifa), read-only mirror (SPEC §6.2). The app can only see what
 * Joshua has shared with the integration from Notion's own UI, so "Refresh
 * available databases" is the honest answer to "why isn't X here".
 */
export function NotionSection({
  configured,
  account,
  config,
}: {
  configured: boolean;
  account: ConnectedAccount | null;
  config: NotionConfig;
}) {
  const [databases, setDatabases] = useState<NotionDatabaseInfo[] | null>(null);
  const [pages, setPages] = useState<Array<{ id: string; title: string; url: string }>>([]);
  const [draft, setDraft] = useState<NotionDatabaseConfig[]>(config.databases);
  const [error, setError] = useState<string | null>(account?.last_error ?? null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const entryFor = (id: string) => draft.find((d) => normalize(d.id) === normalize(id));

  const patch = (db: NotionDatabaseInfo, changes: Partial<NotionDatabaseConfig>) =>
    setDraft((prev) => {
      const existing = prev.find((d) => normalize(d.id) === normalize(db.id));
      const base: NotionDatabaseConfig = existing ?? {
        id: db.id,
        name: db.name,
        taskLike: false,
        map: { title: "", status: "", due: "", assignee: "", doneValues: [] },
      };
      const next = { ...base, name: db.name, ...changes, map: { ...base.map, ...changes.map } };
      return [...prev.filter((d) => normalize(d.id) !== normalize(db.id)), next];
    });

  const remove = (id: string) =>
    setDraft((prev) => prev.filter((d) => normalize(d.id) !== normalize(id)));

  const refresh = () =>
    start(async () => {
      setSaved(false);
      const result = await refreshNotionVisibility();
      if (!result.ok) return setError(result.error);
      setError(null);
      setDatabases(result.data.databases);
      setPages(result.data.pages);
    });

  const save = () =>
    start(async () => {
      const result = await saveNotionConfig({ databases: draft });
      if (!result.ok) return setError(result.error);
      setError(null);
      setSaved(true);
    });

  return (
    <SettingsSection
      title="Notion"
      hint="Read-only. The app mirrors Tarifa work in and links back out; it never writes to Notion."
      action={
        configured ? (
          <Button variant="secondary" onClick={refresh} disabled={pending}>
            {pending ? "Checking" : "Refresh available databases"}
          </Button>
        ) : null
      }
    >
      <Panel>
        <Row
          label="Integration token"
          hint={
            configured
              ? account
                ? `Connected to ${account.external_identity}`
                : "Token present. Refresh to detect the workspace."
              : "NOTION_TOKEN is not set."
          }
        >
          <span className={configured ? "text-[13px] text-ok" : "text-[13px] text-ink-2"}>
            {configured ? "Present" : "Missing"}
          </span>
        </Row>
        {account?.last_synced_at ? (
          <Row label="Last sync" hint={new Date(account.last_synced_at).toLocaleString()} />
        ) : null}
        {draft.length ? (
          <Row
            label="Mirrored databases"
            hint={draft
              .map((d) => `${d.name || d.id}${d.taskLike ? " (tasks)" : ""}`)
              .join(", ")}
          />
        ) : null}
      </Panel>

      {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}

      {databases ? (
        <div className="mt-4 flex flex-col gap-3">
          {databases.length === 0 ? (
            <p className="text-[13px] text-ink-2">
              The integration can see no databases. Share them from Notion: Page → ⋯ → Connections.
            </p>
          ) : null}

          {databases.map((db) => {
            const entry = entryFor(db.id);
            const statusProp = db.properties.find((p) => p.name === entry?.map.status);
            return (
              <div key={db.id} className="rounded-card border border-line bg-paper-2 p-3">
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--accent)]"
                    checked={Boolean(entry)}
                    onChange={(e) => (e.target.checked ? patch(db, {}) : remove(db.id))}
                  />
                  <span className="flex-1 text-[14px]">{db.name}</span>
                  <Mono>{db.properties.length} props</Mono>
                </label>

                {entry ? (
                  <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                    <label className="flex min-h-11 items-center gap-3">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--accent)]"
                        checked={entry.taskLike}
                        onChange={(e) => patch(db, { taskLike: e.target.checked })}
                      />
                      <span className="text-[14px]">Rows are tasks — mirror them into Tarifa</span>
                    </label>

                    {entry.taskLike ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {(["title", "status", "due", "assignee"] as const).map((field) => (
                          <div key={field}>
                            <span className="section-label">{field}</span>
                            <select
                              className={`${selectClass} mt-1`}
                              value={entry.map[field]}
                              onChange={(e) =>
                                patch(db, { map: { ...entry.map, [field]: e.target.value } })
                              }
                            >
                              <option value="">Not mapped</option>
                              {db.properties.map((p) => (
                                <option key={p.name} value={p.name}>
                                  {p.name} ({p.type})
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}

                        {statusProp?.options.length ? (
                          <div className="sm:col-span-2">
                            <span className="section-label">Values that mean done</span>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {statusProp.options.map((option) => {
                                const on = entry.map.doneValues.includes(option);
                                return (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() =>
                                      patch(db, {
                                        map: {
                                          ...entry.map,
                                          doneValues: on
                                            ? entry.map.doneValues.filter((v) => v !== option)
                                            : [...entry.map.doneValues, option],
                                        },
                                      })
                                    }
                                    className={`min-h-11 rounded-full border px-3 text-[13px] ${
                                      on ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2"
                                    }`}
                                  >
                                    {option}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={save} disabled={pending}>
              {pending ? "Saving" : "Save mapping"}
            </Button>
            {saved ? <span className="text-[13px] text-ok">Saved</span> : null}
          </div>

          {pages.length ? (
            <div>
              <p className="section-label mb-1">Pages the integration can see</p>
              <p className="text-[13px] text-ink-2">
                {pages
                  .slice(0, 10)
                  .map((p) => p.title)
                  .join(" · ")}
                {pages.length > 10 ? ` · +${pages.length - 10} more` : ""}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </SettingsSection>
  );
}

function normalize(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}
