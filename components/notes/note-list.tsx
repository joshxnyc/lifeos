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
      <h2 className="section-label mb-2">{title}</h2>
      <ul>
        {notes.map((note) => {
          const domain = note.domain_id ? domainById.get(note.domain_id) : undefined;
          const project = note.project_id ? projectById.get(note.project_id) : undefined;
          return (
            <li key={note.id} className="border-b border-line">
              <Link
                href={`/notes/${note.id}`}
                className="flex min-h-[44px] items-start gap-3 py-3 active:bg-paper-2"
              >
                <span
                  className={cn(
                    "mt-1 h-8 w-[3px] shrink-0 rounded-full",
                    domain ? DOMAIN_COLOR_CLASS[domain.slug as DomainSlug] : "bg-transparent",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[17px] text-ink">
                    {note.title || "Untitled"}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-2">
                    {preview(note.body_md) || "Empty"}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] tabular text-ink-2">
                  {project ? `${project.name} · ` : ""}
                  {shortDate(note.updated_at)}
                </span>
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
