"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteRoutine } from "@/lib/routines";

export function DeleteRoutine({ routineId, logCount }: { routineId: string; logCount: number }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!confirming) {
    return (
      <Button variant="danger" onClick={() => setConfirming(true)}>
        Delete routine
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] text-ink-2">
        Deleting removes {logCount} logged {logCount === 1 ? "day" : "days"} with it. Set the
        routine inactive instead to keep the history.
      </p>
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          variant="danger"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                await deleteRoutine(routineId);
                router.push("/routines");
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not delete the routine.");
              }
            })
          }
        >
          {pending ? "Deleting" : "Delete permanently"}
        </Button>
        <Button variant="secondary" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
