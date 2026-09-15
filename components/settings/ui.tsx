import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AccountStatus } from "@/lib/types";

/** Shared chrome for the Settings sections (DESIGN_BRIEF §5.10, §3). */

export function SettingsSection({
  title,
  hint,
  children,
  action,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="mb-9">
      <div className="mb-2 flex items-end justify-between gap-3">
        <h2 className="section-label">{title}</h2>
        {action}
      </div>
      {hint ? <p className="mb-3 text-[13px] text-ink-2">{hint}</p> : null}
      {children}
    </section>
  );
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    // Canvas 1r: a grouped paper-2 block with hairlines inside, no outer rule.
    <div className={cn("overflow-hidden rounded-card bg-paper-2", className)}>
      {children}
    </div>
  );
}

export function Row({
  label,
  hint,
  children,
  href,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  href?: string;
}) {
  const inner = (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 py-3">
      <div className="min-w-0">
        <div className="text-[15px] font-medium text-ink">{label}</div>
        {hint ? <div className="mt-0.5 text-[13px] text-ink-2">{hint}</div> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
  return (
    <div className="border-b border-line last:border-b-0">
      {href ? (
        <Link href={href} className="block hover:bg-line/30">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </div>
  );
}

const STATUS_TEXT: Record<AccountStatus, string> = {
  active: "Active",
  needs_reauth: "Needs re-auth",
  disabled: "Disabled",
};

// Canvas 1r: status reads as a coloured dot and a word, not a bordered badge.
const STATUS_CLASS: Record<AccountStatus, string> = {
  active: "text-ok",
  needs_reauth: "text-danger",
  disabled: "text-ink-2",
};

const STATUS_DOT: Record<AccountStatus, string> = {
  active: "bg-ok",
  needs_reauth: "bg-danger",
  disabled: "bg-ink-3",
};

export function StatusPill({ status }: { status: AccountStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px]", STATUS_CLASS[status])}>
      <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[status])} aria-hidden />
      {STATUS_TEXT[status]}
    </span>
  );
}

export function JobPill({ status }: { status: "running" | "ok" | "failed" }) {
  const map = {
    running: { label: "Running", cls: "text-ink-2", dot: "bg-ink-3" },
    ok: { label: "OK", cls: "text-ok", dot: "bg-ok" },
    failed: { label: "Failed", cls: "text-danger", dot: "bg-danger" },
  } as const;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px]", map[status].cls)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", map[status].dot)} aria-hidden />
      {map[status].label}
    </span>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("tabular font-mono text-[12px] text-ink-2", className)}>{children}</span>;
}

export const inputClass =
  "h-11 w-full rounded-card border border-line bg-paper px-3 text-[14px] text-ink outline-none focus:border-accent";

export const selectClass =
  "h-11 w-full rounded-card border border-line bg-paper px-2 text-[14px] text-ink outline-none focus:border-accent";
