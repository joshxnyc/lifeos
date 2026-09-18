import Link from "next/link";
import { cn } from "@/lib/utils";
import { DOMAIN_COLOR_CLASS } from "@/components/ui/domain";
import type { Domain, DomainSlug, Person, Project } from "@/lib/types";

export interface NoteFilterState {
  domain?: string; // domain slug
  project?: string; // project id
  person?: string; // person id
}

/** Domain / project / person filter chips over the notes list. */
export function NoteFilters({
  domains,
  projects,
  people,
  current,
}: {
  domains: Domain[];
  projects: Project[];
  people: Person[];
  current: NoteFilterState;
}) {
  const href = (next: NoteFilterState) => {
    const params = new URLSearchParams();
    const merged = { ...current, ...next };
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const query = params.toString();
    return query ? `/notes?${query}` : "/notes";
  };

  const activeDomain = domains.find((d) => d.slug === current.domain);
  const visibleProjects = activeDomain
    ? projects.filter((p) => p.domain_id === activeDomain.id)
    : projects.slice(0, 6);
  const activePerson = people.find((p) => p.id === current.person);

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Chip href={href({ domain: undefined, project: undefined })} active={!current.domain}>
        All
      </Chip>
      {domains.map((d) => (
        <Chip
          key={d.id}
          href={href({ domain: current.domain === d.slug ? undefined : d.slug, project: undefined })}
          active={current.domain === d.slug}
        >
          <span className={cn("size-1.5 rounded-full", DOMAIN_COLOR_CLASS[d.slug as DomainSlug])} />
          {d.name}
        </Chip>
      ))}
      {visibleProjects.map((p) => (
        <Chip
          key={p.id}
          href={href({ project: current.project === p.id ? undefined : p.id })}
          active={current.project === p.id}
        >
          {p.name}
        </Chip>
      ))}
      {activePerson ? (
        <Chip href={href({ person: undefined })} active>
          {activePerson.name} ×
        </Chip>
      ) : null}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        // Canvas 2d: the chosen filter is an ink fill; the rest are hairlines.
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[13px]",
        active ? "border-ink bg-ink text-paper" : "border-line text-ink",
      )}
    >
      {children}
    </Link>
  );
}
