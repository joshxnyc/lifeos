"use client";

// ⌘K command palette: global search plus quick-add (SPEC §9). ⌘J jumps to
// capture. The tasks feature owns quick-add parsing (lib/domain/quick-add).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import type { Domain, Project } from "@/lib/types";

export function CommandPalette({ domains, projects }: { domains: Domain[]; projects: Project[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        router.push("/capture");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  if (!open) return null;

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink/20 pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="mx-auto w-full max-w-lg px-4" onClick={(e) => e.stopPropagation()}>
        <Command
          shouldFilter
          className="overflow-hidden rounded-card border border-line bg-paper shadow-whisper"
        >
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder='Search, or add: "Send memo to Bernhard fri #tarifa !high"'
            className="h-12 w-full border-b border-line bg-transparent px-4 text-[15px] outline-none placeholder:text-ink-3"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <Command.List className="max-h-72 overflow-y-auto p-2">
            {query.trim() ? (
              <Command.Item
                value={`add ${query}`}
                onSelect={() => go(`/tasks?add=${encodeURIComponent(query)}`)}
                className="cursor-pointer rounded-card px-3 py-2 text-[14px] data-[selected=true]:bg-accent-soft"
              >
                Add task: “{query}”
              </Command.Item>
            ) : null}
            {query.trim() ? (
              <Command.Item
                value={`search ${query}`}
                onSelect={() => go(`/search?q=${encodeURIComponent(query)}`)}
                className="cursor-pointer rounded-card px-3 py-2 text-[14px] data-[selected=true]:bg-accent-soft"
              >
                Search everything for “{query}”
              </Command.Item>
            ) : null}
            <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:section-label [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
              {[
                ["/today", "Today"],
                ["/tasks", "Tasks"],
                ["/queue", "Queue"],
                ["/routines", "Routines"],
                ["/people", "People"],
                ["/notes", "Notes"],
                ["/review", "Weekly Review"],
                ["/settings", "Settings"],
              ].map(([href, label]) => (
                <Command.Item
                  key={href}
                  value={label}
                  onSelect={() => go(href as string)}
                  className="cursor-pointer rounded-card px-3 py-2 text-[14px] data-[selected=true]:bg-accent-soft"
                >
                  {label}
                </Command.Item>
              ))}
              {domains.map((d) => (
                <Command.Item
                  key={d.id}
                  value={`domain ${d.name}`}
                  onSelect={() => go(`/domains/${d.slug}`)}
                  className="cursor-pointer rounded-card px-3 py-2 text-[14px] data-[selected=true]:bg-accent-soft"
                >
                  {d.name}
                </Command.Item>
              ))}
              {projects.map((p) => (
                <Command.Item
                  key={p.id}
                  value={`project ${p.name}`}
                  onSelect={() => go(`/projects/${p.id}`)}
                  className="cursor-pointer rounded-card px-3 py-2 text-[14px] data-[selected=true]:bg-accent-soft"
                >
                  {p.name}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
