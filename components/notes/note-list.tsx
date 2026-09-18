import Link from "next/link";
import { cn } from "@/lib/utils";
import { DOMAIN_COLOR_CLASS } from "@/components/ui/domain";
import { DEFAULT_SETTINGS, type Domain, type DomainSlug, type Note, type Project } from "@/lib/types";

/** Notes grouped Pinned / Recent (DESIGN_BRIEF §5.7). */
export function NoteList({
  notes,
  domains,
  projects,
}: {
  notes: Note[];
  domains: Domain[];
  projects: Project[];
}) {
  const pinned = notes.filter((n) => n.pinned);
  const recent = notes.filter((n) => !n.pinned);

  return (
    <div className="flex flex-col gap-7">
      {pinned.length ? (
        <Group title="Pinned" notes={pinned} domains={domains} projects={projects} />
      ) : null}
      {recent.length ? (
        <Group title="Recent" notes={recent} domains={domains} projects={projects} />
      ) : null}
    </div>
  );
}

function Group({
  title,
  notes,
  domains,
  projects,
}: {
  title: string;
  notes: Note[];
  domains: Domain[];
  projects: Project[];
}) {
  const domainById = new Map(domains.map((d) => [d.id, d]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  return (
    <section>
      <h2 className="section-label">{title}</h2>
      <ul className="mt-1">
        {notes.map((note) => {
          const domain = note.domain_id ? domainById.get(note.domain_id) : undefined;
          const project = note.project_id ? projectById.get(note.project_id) : undefined;
          return (
            <li key={note.id} className="border-b border-line">
              {/* Canvas 2d: title and date on one line, a preview under it,
                  then the domain/project as a chip with a colour dot. */}
              <Link href={`/notes/${note.id}`} className="block py-3 active:bg-paper-2">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-display text-[17px] font-medium text-ink">
                    {note.title || "Untitled"}
                  </span>
                  <span className="tabular shrink-0 text-[12px] text-ink-2">
                    {shortDate(note.updated_at)}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-ink-2">
                  {preview(note.body_md) || "Empty"}
                </span>
                {domain || project ? (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-2 px-2 py-0.5 text-[12px] text-ink">
                      {domain ? (
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            DOMAIN_COLOR_CLASS[domain.slug as DomainSlug],
                          )}
                        />
                      ) : null}
                      {project?.name ?? domain?.name}
                    </span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function preview(body: string): string {
  const line = body.split("\n").find((l) => l.trim());
  return line ? line.replace(/^#+\s*/, "").trim().slice(0, 120) : "";
}

function shortDate(iso: string): string {
  // Rendered on the server, so the timezone is pinned rather than the host's.
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: DEFAULT_SETTINGS.timezone,
  }).format(new Date(iso));
}
