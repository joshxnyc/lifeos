"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

// Catch-all for the review tree, so a failed action or query shows a message
// instead of a dead screen. Decisions save as they are made, so nothing is
// lost by retrying.
export default function ReviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="py-16">
      <p className="display-lead">The review hit an error.</p>
      <p className="mt-2 text-[14px] text-ink-2">
        Every decision saves the moment it is made, so nothing you decided is lost.
      </p>
      {error?.message ? <p className="mt-2 text-[13px] text-danger">{error.message}</p> : null}
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Link href="/review" className="flex min-h-11 items-center text-[15px] text-accent">
          Back to reviews
        </Link>
      </div>
    </div>
  );
}
