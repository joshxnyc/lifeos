"use client";

// "Sync now" / "Run now" beside a job or integration row. The outcome lands as
// a toast (numbers, no adjectives) and the page refreshes so the run shows up
// in the jobs list immediately.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { runJobNow } from "@/app/(app)/settings/actions";
import { toast } from "@/components/tasks/toast";
import { FilingIndicator } from "@/components/capture/filing-indicator";

export function RunJobButton({ job, label = "Run now" }: { job: string; label?: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await runJobNow(job);
          toast(res.ok ? `${job}: ${res.detail}` : res.detail);
          router.refresh();
        })
      }
      className="inline-flex h-11 items-center rounded-card px-2 text-[13px] font-medium text-accent transition-transform active:scale-95 disabled:opacity-50"
    >
      {pending ? <FilingIndicator label="Running…" /> : label}
    </button>
  );
}
