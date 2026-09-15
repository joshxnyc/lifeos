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

export function DomainChip({ slug, name, className }: { slug: DomainSlug; name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[12px] text-ink-2",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOMAIN_COLOR_CLASS[slug])} />
      {name}
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
