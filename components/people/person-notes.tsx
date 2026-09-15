"use client";

import { useState, useTransition } from "react";
import { savePersonNotesAction } from "@/app/(app)/people/actions";

/**
 * The person's own notes (people.notes_md) — where accepted `person_fact`
 * suggestions and logged contacts append their dated lines. Saves on blur.
 */
export function PersonNotes({ personId, notesMd }: { personId: string; notesMd: string | null }) {
  const [value, setValue] = useState(notesMd ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (value === (notesMd ?? "")) return;
    startTransition(async () => {
      await savePersonNotesAction(personId, value);
      setSaved("Saved");
    });
  }

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(null);
        }}
        onBlur={save}
        rows={Math.min(16, Math.max(4, value.split("\n").length + 1))}
        placeholder="Notes about this person"
        className="w-full rounded-card border border-line bg-paper-2 p-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-accent"
      />
      <p className="mt-1 h-4 text-[12px] text-ink-2">{pending ? "Saving" : (saved ?? "")}</p>
    </div>
  );
}
