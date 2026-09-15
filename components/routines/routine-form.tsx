"use client";

// Create/edit form for a routine. Rendered inline on the detail screen and
// inside a bottom sheet from the Routines screen (DESIGN_BRIEF §4: sheets
// slide from the bottom for create/edit forms).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createRoutine, updateRoutine, type RoutineInput } from "@/lib/routines";
import { DAY_INITIALS, DAY_LABELS, WEEK_ORDER, shortTime } from "./format";

export interface RoutineFormValues {
  id?: string;
  name: string;
  emoji: string | null;
  schedule_days: number[];
  reminder_time: string | null;
  grace_minutes: number;
  nudge_enabled: boolean;
  domain_id: string | null;
  write_to_calendar: boolean;
  active: boolean;
}

const BLANK: RoutineFormValues = {
  name: "",
  emoji: null,
  schedule_days: [1, 2, 3, 4, 5],
  reminder_time: "07:30",
  grace_minutes: 120,
  nudge_enabled: true,
  domain_id: null,
  write_to_calendar: false,
  active: true,
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="section-label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1 text-[12px] text-ink-2">{hint}</p> : null}
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="min-w-0">
        <p className="text-[14px] text-ink">{label}</p>
        {hint ? <p className="mt-0.5 text-[12px] text-ink-2">{hint}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="flex size-11 shrink-0 items-center justify-center self-center"
      >
        <span
          className={cn(
            "relative block h-6 w-11 rounded-full border transition-colors",
            checked ? "border-accent bg-accent" : "border-line bg-paper-2",
          )}
        >
          <span
            className={cn(
              "absolute top-[2px] size-[18px] rounded-full bg-paper transition-[left] duration-150",
              checked ? "left-[24px]" : "left-[2px]",
            )}
          />
        </span>
      </button>
    </div>
  );
}

const inputClass =
  "h-11 w-full rounded-card border border-line bg-paper-2 px-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent";

export function RoutineForm({
  initial,
  domains,
  onDone,
  autoFocusName = false,
}: {
  initial?: RoutineFormValues;
  domains: { id: string; name: string }[];
  onDone?: () => void;
  autoFocusName?: boolean;
}) {
  const [values, setValues] = useState<RoutineFormValues>(initial ?? BLANK);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const set = <K extends keyof RoutineFormValues>(key: K, value: RoutineFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const toggleDay = (day: number) =>
    setValues((v) => ({
      ...v,
      schedule_days: v.schedule_days.includes(day)
        ? v.schedule_days.filter((d) => d !== day)
        : [...v.schedule_days, day].sort((a, b) => a - b),
    }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload: RoutineInput = {
      name: values.name,
      emoji: values.emoji,
      schedule_days: values.schedule_days,
      reminder_time: values.reminder_time ? shortTime(values.reminder_time) : null,
      grace_minutes: values.grace_minutes,
      nudge_enabled: values.nudge_enabled,
      domain_id: values.domain_id,
      write_to_calendar: values.write_to_calendar,
      active: values.active,
    };
    startTransition(async () => {
      try {
        if (initial?.id) await updateRoutine(initial.id, payload);
        else await createRoutine(payload);
        router.refresh();
        onDone?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save the routine.");
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex gap-2">
        <div className="w-16 shrink-0">
          <Field label="Emoji">
            <input
              className={cn(inputClass, "text-center")}
              value={values.emoji ?? ""}
              onChange={(e) => set("emoji", e.target.value || null)}
              maxLength={4}
              placeholder="—"
              aria-label="Emoji"
            />
          </Field>
        </div>
        <div className="min-w-0 flex-1">
          <Field label="Name">
            <input
              className={inputClass}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Gym"
              required
              autoFocus={autoFocusName}
            />
          </Field>
        </div>
      </div>

      <div>
        <span className="section-label">Days</span>
        <div className="mt-1.5 flex gap-1.5">
          {WEEK_ORDER.map((day) => {
            const on = values.schedule_days.includes(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                aria-pressed={on}
                aria-label={DAY_LABELS[day]}
                className={cn(
                  "h-11 flex-1 rounded-card border text-[13px] font-medium transition-colors",
                  on
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-paper-2 text-ink-2",
                )}
              >
                {DAY_INITIALS[day]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <Field label="Reminder">
            <input
              type="time"
              className={inputClass}
              value={shortTime(values.reminder_time) ?? ""}
              onChange={(e) => set("reminder_time", e.target.value || null)}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Grace (min)">
            <input
              type="number"
              min={5}
              max={1440}
              step={5}
              className={cn(inputClass, "tabular")}
              value={values.grace_minutes}
              onChange={(e) => set("grace_minutes", Number(e.target.value))}
            />
          </Field>
        </div>
      </div>

      <Field label="Domain" hint="Optional. Sets the colour edge on the tile.">
        <select
          className={inputClass}
          value={values.domain_id ?? ""}
          onChange={(e) => set("domain_id", e.target.value || null)}
        >
          <option value="">None</option>
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="divide-y divide-line border-y border-line">
        <Toggle
          checked={values.nudge_enabled}
          onChange={(v) => set("nudge_enabled", v)}
          label="Nudge if not logged"
          hint="A second push after the grace window. Dropped inside quiet hours."
        />
        <Toggle
          checked={values.write_to_calendar}
          onChange={(v) => set("write_to_calendar", v)}
          label="Write to calendar"
          hint="Creates a recurring event. Needs a connected Google account, which arrives in Phase 3."
        />
        <Toggle
          checked={values.active}
          onChange={(v) => set("active", v)}
          label="Active"
          hint="Inactive routines keep their history and stop sending pushes."
        />
      </div>

      {error ? <p className="text-[13px] text-danger">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending} className="flex-1">
          {pending ? "Saving" : initial?.id ? "Save changes" : "Add routine"}
        </Button>
        {onDone ? (
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function AddRoutineButton({ domains }: { domains: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Add routine
      </Button>
      {open ? (
        <RoutineSheet title="New routine" onClose={() => setOpen(false)}>
          <RoutineForm domains={domains} onDone={() => setOpen(false)} autoFocusName />
        </RoutineSheet>
      ) : null}
    </>
  );
}

export function RoutineSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/20 md:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-[16px] border border-line bg-paper p-4 pb-safe shadow-whisper md:rounded-card"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-[22px] font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 items-center justify-center text-ink-2"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
