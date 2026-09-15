import { cn } from "@/lib/utils";
import type { DomainSlug } from "@/lib/types";

// Domain colors appear only as edges and dots, never full backgrounds
// (DESIGN_BRIEF §3).
export const DOMAIN_COLOR_CLASS: Record<DomainSlug, string> = {
  personal: "bg-domain-personal",
  almedia: "bg-domain-almedia",
  tarifa: "bg-domain-tarifa",
  misc: "bg-domain-misc",
};

export const DOMAIN_EDGE_CLASS: Record<DomainSlug, string> = {
  personal: "border-l-domain-personal",
  almedia: "border-l-domain-almedia",
  tarifa: "border-l-domain-tarifa",
  misc: "border-l-domain-misc",
};

/** Canvas chip: paper-2 fill, 13px ink, a 7px domain dot. No border. */
export function DomainChip({ slug, name, className }: { slug: DomainSlug; name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-paper-2 px-2.5 py-0.5 text-[13px] text-ink",
        className,
      )}
    >
      <span className={cn("size-[7px] shrink-0 rounded-full", DOMAIN_COLOR_CLASS[slug])} />
      {name}
    </span>
  );
}

/** A plain fact chip beside a DomainChip — project, person, a due date. */
export function MetaChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-paper-2 px-2.5 py-0.5 text-[13px] text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The mirrored-from-Notion glyph: a 12px outlined "N" (canvas 1a / 1f / 2f). */
export function NotionGlyph({ className }: { className?: string }) {
  return (
    <span
      aria-label="Mirrored from Notion"
      className={cn(
        "inline-flex size-3 shrink-0 items-center justify-center rounded-[2px] border-[1.5px] border-ink-2 text-[8px] font-bold leading-none text-ink-2",
        className,
      )}
    >
      N
    </span>
  );
}

export function PersonAvatar({
  name,
  slug,
  size = 28,
}: {
  name: string;
  slug?: DomainSlug | null;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white",
        slug ? DOMAIN_COLOR_CLASS[slug] : "bg-ink-3",
      )}
    >
      {initials}
    </span>
  );
}
