import Link from "next/link";
import { cn } from "@/lib/utils";
import { DOMAIN_COLOR_CLASS } from "@/components/ui/domain";
import { KIND_LABEL } from "@/components/search/provider-glyph";
import type { Domain, DomainSlug, SourceKind } from "@/lib/types";

export interface SearchFilterState {
  q?: string;
  domain?: string;
  kind?: string;
  range?: string;
}

export const RANGES: Record<string, { label: string; days: number | null }> = {
  all: { label: "Any time", days: null },
  "7d": { label: "Last 7 days", days: 7 },
  "30d": { label: "Last 30 days", days: 30 },
  "90d": { label: "Last 90 days", days: 90 },
};

const KINDS: SourceKind[] = ["email_thread", "calendar_event", "notion_page", "granola_note"];

export function SearchFilters({
  domains,
  current,
}: {
  domains: Domain[];
  current: SearchFilterState;
}) {
  const href = (next: SearchFilterState) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...current, ...next })) if (value) params.set(key, value);
    return `/search?${params.toString()}`;
  };

  return (
    <div className="mb-6 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Chip href={href({ domain: undefined })} active={!current.domain}>
          All domains
        </Chip>
        {domains.map((d) => (
          <Chip
            key={d.id}
            href={href({ domain: current.domain === d.slug ? undefined : d.slug })}
            active={current.domain === d.slug}
          >
            <span className={cn("size-1.5 rounded-full", DOMAIN_COLOR_CLASS[d.slug as DomainSlug])} />
            {d.name}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip href={href({ kind: undefined })} active={!current.kind}>
          All sources
        </Chip>
        {KINDS.map((kind) => (
          <Chip
            key={kind}
            href={href({ kind: current.kind === kind ? undefined : kind })}
            active={current.kind === kind}
          >
            {KIND_LABEL[kind]}
          </Chip>
        ))}
        {Object.entries(RANGES)
          .filter(([key]) => key !== "all")
          .map(([key, range]) => (
            <Chip
              key={key}
              href={href({ range: current.range === key ? undefined : key })}
              active={current.range === key}
            >
              {range.label}
            </Chip>
          ))}
      </div>
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[13px]",
        active ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2",
      )}
    >
      {children}
    </Link>
  );
}
