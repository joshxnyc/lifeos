"use client";

import { useState, useTransition } from "react";
import { saveNotificationSettings, saveNotificationToggles } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Panel, Row, inputClass, selectClass } from "@/components/settings/ui";
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS,
  type NotificationToggles,
} from "@/lib/integrations/notification-kinds";
import type { Settings } from "@/lib/types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Times, quiet hours and per-kind switches (SPEC §8). Everything here is
 * enqueue-time or send-time policy for notifications-tick, which is the only
 * sender.
 */
export function NotificationsForm({
  settings,
  toggles,
  pushoverConfigured,
}: {
  settings: Settings;
  toggles: NotificationToggles;
  pushoverConfigured: boolean;
}) {
  const [morning, setMorning] = useState(settings.morning_brief_time);
  const [evening, setEvening] = useState(settings.evening_closeout_time);
  const [reviewDay, setReviewDay] = useState(settings.weekly_review_day);
  const [reviewTime, setReviewTime] = useState(settings.weekly_review_time);
  const [quietStart, setQuietStart] = useState(settings.quiet_hours.start);
  const [quietEnd, setQuietEnd] = useState(settings.quiet_hours.end);
  const [digest, setDigest] = useState(settings.queue_digest_enabled);
  const [pushover, setPushover] = useState(settings.pushover_enabled);
  const [kinds, setKinds] = useState<NotificationToggles>(toggles);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setSaved(false);
      const result = await saveNotificationSettings({
        morning_brief_time: morning,
        evening_closeout_time: evening,
        weekly_review_day: reviewDay,
        weekly_review_time: reviewTime,
        quiet_start: quietStart,
        quiet_end: quietEnd,
        queue_digest_enabled: digest,
        pushover_enabled: pushover,
      });
      if (!result.ok) return setError(result.error);
      const toggleResult = await saveNotificationToggles(kinds);
      if (!toggleResult.ok) return setError(toggleResult.error);
      setError(null);
      setSaved(true);
    });

  const time = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div>
      <label className="section-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="time"
        className={`${inputClass} mt-1`}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {time("morning-time", "Morning brief", morning, setMorning)}
        {time("evening-time", "Evening close-out", evening, setEvening)}
        <div>
          <label className="section-label" htmlFor="review-day">
            Weekly review
          </label>
          <select
            id="review-day"
            className={`${selectClass} mt-1`}
            value={reviewDay}
            onChange={(e) => setReviewDay(Number(e.target.value))}
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </div>
        {time("review-time", "Review time", reviewTime, setReviewTime)}
        {time("quiet-start", "Quiet hours start", quietStart, setQuietStart)}
        {time("quiet-end", "Quiet hours end", quietEnd, setQuietEnd)}
      </div>
      <p className="text-[13px] text-ink-2">
        Nothing is sent inside quiet hours. Missed-routine nudges that fall inside them are dropped,
        not delayed.
      </p>

      <Panel>
        {NOTIFICATION_KINDS.map((kind) => (
          <Row key={kind} label={NOTIFICATION_KIND_LABELS[kind] ?? kind}>
            <input
              type="checkbox"
              className="size-5 accent-[var(--accent)]"
              aria-label={NOTIFICATION_KIND_LABELS[kind] ?? kind}
              checked={kinds[kind] !== false}
              onChange={(e) => setKinds((prev) => ({ ...prev, [kind]: e.target.checked }))}
            />
          </Row>
        ))}
        <Row
          label="Queue digest"
          hint="At most once a day, only when three or more suggestions are waiting."
        >
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            aria-label="Queue digest"
            checked={digest}
            onChange={(e) => setDigest(e.target.checked)}
          />
        </Row>
        <Row
          label="Pushover fallback"
          hint={
            pushoverConfigured
              ? "Keys detected. Used as a second channel if iOS web push is flaky."
              : "Set PUSHOVER_USER_KEY and PUSHOVER_APP_TOKEN to use this."
          }
        >
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            aria-label="Pushover fallback"
            checked={pushover}
            disabled={!pushoverConfigured}
            onChange={(e) => setPushover(e.target.checked)}
          />
        </Row>
      </Panel>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={pending}>
          {pending ? "Saving" : "Save"}
        </Button>
        {saved ? <span className="text-[13px] text-ok">Saved</span> : null}
        {error ? <span className="text-[13px] text-danger">{error}</span> : null}
      </div>
    </div>
  );
}
