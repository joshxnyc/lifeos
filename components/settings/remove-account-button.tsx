"use client";

import { useState, useTransition } from "react";
import { removeAccount } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";

/** Two-step remove: the archive survives, but the row and its tokens go. */
export function RemoveAccountButton({ id, label }: { id: string; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <Button variant="ghost" className="px-2" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-[13px] text-ink-2">Remove {label}? Archived items stay.</span>
      <Button variant="ghost" className="px-2" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      <Button
        variant="danger"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await removeAccount({ id });
            if (!result.ok) setError(result.error);
            else setConfirming(false);
          })
        }
      >
        {pending ? "Removing" : "Remove"}
      </Button>
      {error ? <span className="text-[13px] text-danger">{error}</span> : null}
    </div>
  );
}
