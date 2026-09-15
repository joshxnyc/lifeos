"use client";

import { useState, useTransition } from "react";
import { retryCapture } from "@/app/(app)/capture/actions";

export function RetryButton({ captureId }: { captureId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await retryCapture(captureId);
            setError(res.ok ? null : res.error);
          })
        }
        className="h-11 px-2 text-[13px] text-accent disabled:opacity-50"
      >
        {pending ? "Retrying…" : "Retry"}
      </button>
      {error ? <span className="text-[12px] text-danger">{error}</span> : null}
    </span>
  );
}
