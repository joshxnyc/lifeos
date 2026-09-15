"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fetchCalendars, updateAccount, type CalendarOption } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { inputClass, Panel, selectClass } from "@/components/settings/ui";
import type { ConnectedAccountSummary, Domain } from "@/lib/types";

/**
 * Per-account setup (SPEC §6.1): label, default domain for everything this
 * account brings in, which calendars to read, and the single calendar the app
 * may write to.
 */
export function AccountForm({
  account,
  domains,
  calendars,
  calendarError,
}: {
  account: ConnectedAccountSummary;
  domains: Domain[];
  calendars: CalendarOption[];
  calendarError: string | null;
}) {
  const router = useRouter();
  const [label, setLabel] = useState(account.label);
  const [domainId, setDomainId] = useState(account.default_domain_id ?? "");
  const [readIds, setReadIds] = useState<string[]>(account.read_calendar_ids ?? []);
  const [writableId, setWritableId] = useState(account.writable_calendar_id ?? "");
  const [options, setOptions] = useState<CalendarOption[]>(calendars);
  const [error, setError] = useState<string | null>(calendarError);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const writableOptions = options.filter((c) => c.accessRole === "owner" || c.accessRole === "writer");

  const toggleRead = (id: string) =>
    setReadIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = () =>
    start(async () => {
      setSaved(false);
      const result = await updateAccount({
        id: account.id,
        label: label.trim() || account.external_identity,
        defaultDomainId: domainId || null,
        readCalendarIds: readIds,
        writableCalendarId: writableId || null,
      });
      if (!result.ok) setError(result.error);
      else {
        setError(null);
        setSaved(true);
        router.refresh();
      }
    });

  const refresh = () =>
    start(async () => {
      const result = await fetchCalendars(account.id);
      if (result.ok) {
        setOptions(result.calendars);
        setError(null);
      } else setError(result.error);
    });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <label className="section-label" htmlFor="account-label">
          Label
        </label>
        <input
          id="account-label"
          className={`${inputClass} mt-1.5`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Personal Gmail"
        />
        <p className="mt-1 text-[13px] text-ink-2">{account.external_identity}</p>
      </div>

      <div>
        <label className="section-label" htmlFor="account-domain">
          Default domain
        </label>
        <select
          id="account-domain"
          className={`${selectClass} mt-1.5`}
          value={domainId}
          onChange={(e) => setDomainId(e.target.value)}
        >
          <option value="">No default</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[13px] text-ink-2">
          Everything this account brings in starts in this domain.
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-end justify-between gap-3">
          <span className="section-label">Calendars to read</span>
          <Button variant="ghost" className="px-2" onClick={refresh} disabled={pending}>
            Refresh list
          </Button>
        </div>
        {error ? <p className="mb-2 text-[13px] text-danger">{error}</p> : null}
        {options.length === 0 ? (
          <p className="text-[13px] text-ink-2">
            No calendars loaded. Reconnect the account, then refresh.
          </p>
        ) : (
          <Panel>
            {options.map((c) => (
              <label
                key={c.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-line px-3 py-2 last:border-b-0"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--accent)]"
                  checked={readIds.includes(c.id)}
                  onChange={() => toggleRead(c.id)}
                />
                <span className="min-w-0 flex-1 truncate text-[14px]">{c.summary}</span>
                {c.primary ? <span className="text-[12px] text-ink-2">primary</span> : null}
              </label>
            ))}
          </Panel>
        )}
      </div>

      <div>
        <label className="section-label" htmlFor="account-writable">
          Calendar the app may write to
        </label>
        <select
          id="account-writable"
          className={`${selectClass} mt-1.5`}
          value={writableId}
          onChange={(e) => setWritableId(e.target.value)}
        >
          <option value="">None — block time is off</option>
          {writableOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.summary}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[13px] text-ink-2">
          Create a dedicated calendar called LifeOS in Google and pick it here. The app only ever
          writes to this one calendar, and never edits an event it did not create.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={pending}>
          {pending ? "Saving" : "Save"}
        </Button>
        {saved ? <span className="text-[13px] text-ok">Saved</span> : null}
      </div>
    </div>
  );
}
