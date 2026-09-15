"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonFormSheet, type PersonFormValues } from "@/components/people/person-form";
import { deletePersonAction, mergePeopleAction } from "@/app/(app)/people/actions";
import type { DomainSlug } from "@/lib/types";

// Overflow menu on the Person page: Edit, "Merge into…", Delete
// (DESIGN_BRIEF §5.6). Merge moves tasks, notes and source links across and
// removes the duplicate; the confirmation is informational — there is no undo.

export function PersonMenu({
  person,
  domains,
  others,
}: {
  person: PersonFormValues & { id: string; name: string };
  domains: { id: string; name: string; slug: DomainSlug }[];
  others: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [target, setTarget] = useState("");
  const [pending, startTransition] = useTransition();

  function merge() {
    if (!target) return;
    startTransition(async () => {
      await mergePeopleAction(target, person.id);
    });
  }

  function remove() {
    startTransition(async () => {
      await deletePersonAction(person.id);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="More"
        onClick={() => setOpen((v) => !v)}
        className="flex size-11 items-center justify-center rounded-full border border-line text-ink-2"
      >
        <MoreHorizontal size={18} />
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-40 w-60 rounded-card border border-line bg-paper p-2 shadow-whisper">
          <PersonFormSheet
            person={person}
            domains={domains}
            trigger={
              <button className="flex h-11 w-full items-center px-2 text-left text-[14px] text-ink">
                Edit
              </button>
            }
          />
          <button
            onClick={() => setMerging((v) => !v)}
            className="flex h-11 w-full items-center px-2 text-left text-[14px] text-ink"
          >
            Merge into…
          </button>
          {merging ? (
            <div className="space-y-2 p-2">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="h-11 w-full rounded-card border border-line bg-paper-2 px-2 text-[14px] text-ink"
              >
                <option value="">Pick the person to keep</option>
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <p className="text-[12px] text-ink-2">
                {person.name} is removed. Tasks, notes and emails move across. This cannot be undone.
              </p>
              <Button variant="primary" disabled={!target || pending} onClick={merge}>
                Merge
              </Button>
            </div>
          ) : null}
          <button
            onClick={remove}
            disabled={pending}
            className="flex h-11 w-full items-center px-2 text-left text-[14px] text-danger"
          >
            Delete person
          </button>
        </div>
      ) : null}
    </div>
  );
}
