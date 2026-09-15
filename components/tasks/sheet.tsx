"use client";

// Bottom sheet on mobile, centred panel on desktop (DESIGN_BRIEF §4).
// Portalled to <body> so it is never trapped by a transformed swipe row.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/25 md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-paper p-4 pb-safe shadow-whisper md:max-w-md md:rounded-card md:pb-4",
          className,
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-[17px] font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex h-11 min-w-11 items-center justify-center px-2 text-[13px] text-ink-2"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Full-width sheet row button — 44px target, hairline separated. */
export function SheetOption({
  label,
  meta,
  onClick,
  selected,
}: {
  label: string;
  meta?: string;
  onClick: () => void;
  selected?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-3 border-b border-line px-1 py-2.5 text-left text-[15px] last:border-b-0",
        selected ? "text-accent" : "text-ink",
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      {meta ? <span className="tabular shrink-0 text-[13px] text-ink-2">{meta}</span> : null}
    </button>
  );
}
