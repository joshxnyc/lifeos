"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { createPersonAction, updatePersonAction } from "@/app/(app)/people/actions";
import type { DomainSlug } from "@/lib/types";

// Create/edit sheet (DESIGN_BRIEF §4: sheets slide from the bottom for
// create/edit forms).

export interface PersonFormValues {
  id?: string;
  name?: string;
  emails?: string[];
  company?: string | null;
  role?: string | null;
  relationship?: string | null;
  phone?: string | null;
  domain_id?: string | null;
}

export function PersonFormSheet({
  trigger,
  person,
  domains,
}: {
  trigger: React.ReactNode;
  person?: PersonFormValues;
  domains: { id: string; name: string; slug: DomainSlug }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const editing = Boolean(person?.id);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        if (editing && person?.id) await updatePersonAction(person.id, formData);
        else await createPersonAction(formData);
        setOpen(false);
      } catch (err) {
        // redirect() throws a control-flow error; let it through.
        if (err && typeof err === "object" && "digest" in err) throw err;
        setError(err instanceof Error ? err.message : "That didn't save.");
      }
    });
  }

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/20 md:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[90dvh] w-full max-w-[520px] overflow-y-auto rounded-t-2xl bg-paper p-5 pb-safe shadow-whisper md:rounded-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="display-lead">
              {editing ? "Edit person" : "New person"}
            </h2>
            <form action={submit} className="mt-4 space-y-3">
              <Field label="Name" name="name" defaultValue={person?.name} required />
              <Field
                label="Emails"
                name="emails"
                defaultValue={(person?.emails ?? []).join(", ")}
                hint="Comma separated"
              />
              <Field label="Relationship" name="relationship" defaultValue={person?.relationship ?? ""} />
              <Field label="Company" name="company" defaultValue={person?.company ?? ""} />
              <Field label="Role" name="role" defaultValue={person?.role ?? ""} />
              <Field label="Phone" name="phone" defaultValue={person?.phone ?? ""} />
              <label className="block">
                <span className="section-label">Domain</span>
                <select
                  name="domain_id"
                  defaultValue={person?.domain_id ?? ""}
                  className="mt-1 h-11 w-full rounded-card border border-line bg-paper-2 px-3 text-[15px] text-ink outline-none focus:border-accent"
                >
                  <option value="">No domain</option>
                  {domains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>

              {error ? <p className="text-[13px] text-danger">{error}</p> : null}

              <div className="flex items-center gap-2 pt-2">
                <Button type="submit" variant="primary" disabled={pending}>
                  {editing ? "Save" : "Add person"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required,
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="section-label">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="mt-1 h-11 w-full rounded-card border border-line bg-paper-2 px-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
      />
      {hint ? <span className="mt-0.5 block text-[12px] text-ink-2">{hint}</span> : null}
    </label>
  );
}
