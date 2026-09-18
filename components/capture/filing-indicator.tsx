"use client";

// The shared "something is happening" mark: a pulsing accent dot beside a
// label. Motion is a token-coloured opacity pulse only, and it stops under
// prefers-reduced-motion (globals.css kills the duration; motion-reduce
// drops the animation outright).

import { cn } from "@/lib/utils";

export function FilingDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 animate-pulse rounded-full bg-accent motion-reduce:animate-none", className)}
    />
  );
}

export function FilingIndicator({
  label = "Filing…",
  dotClassName,
}: {
  label?: string;
  /** Recolour the dot when it sits on a non-paper surface (e.g. the accent Add pill). */
  dotClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <FilingDot className={dotClassName} />
      {label}
    </span>
  );
}
