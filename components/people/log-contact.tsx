"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { logContactAction } from "@/app/(app)/people/actions";

/** "Log contact" sets last contact to now, with an optional one-line note. */
export function LogContact({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      await logContactAction(personId, note.trim() || undefined);
      setNote("");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Log contact
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <input
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What was it about (optional)"
        className="h-11 min-w-0 flex-1 rounded-card border border-line bg-paper-2 px-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
      />
      <Button variant="primary" disabled={pending} onClick={save}>
        Save
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
