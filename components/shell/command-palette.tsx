"use client";

// ⌘K command palette: navigation, search hand-off and real quick-add (SPEC §9).
// ⌘J jumps to capture. Parsing is lib/domain/quick-add; writing is the tasks
// server action. It also hosts the app's single toast outlet, because the
// palette is mounted once in the app shell.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { createClient } from "@/lib/supabase/client";
import { createTask } from "@/app/(app)/tasks/actions";
import { ParsedChips, parseSafely } from "@/components/tasks/quick-add";
import { ToastHost, toast } from "@/components/tasks/toast";
import { useSmartAdd } from "@/components/capture/use-smart-add";
import type { Domain, Project } from "@/lib/types";
import type { PersonOption } from "@/components/tasks/types";

const NAV: Array<[string, string]> = [
  ["/today", "Today"],
  ["/tasks", "Tasks"],
  ["/capture", "Capture"],
  ["/queue", "Queue"],
  ["/routines", "Routines"],
  ["/people", "People"],
  ["/notes", "Notes"],
  ["/search", "Search"],
  ["/review", "Weekly Review"],
  ["/settings", "Settings"],
];

const ITEM_CLASS =
  // Canvas 2j: rows are flush, selection shows as an accent left edge.
  "cursor-pointer border-l-[3px] border-l-transparent px-[15px] py-2 text-[14px] data-[selected=true]:border-l-accent data-[selected=true]:bg-paper-2";

function localToday(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA").format(new Date());
  }
}

export function CommandPalette({ domains, projects }: { domains: Domain[]; projects: Project[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [timezone, setTimezone] = useState<string>(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  );
  const [loaded, setLoaded] = useState(false);
  const [, startTransition] = useTransition();
  const { smartAdd } = useSmartAdd();
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

  // People and the timezone are only needed once the palette is used.
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    const supabase = createClient();
    void (async () => {
      const [{ data: peopleRows }, { data: tzRow }] = await Promise.all([
        supabase.from("people").select("id, name").order("name").limit(300),
        supabase.from("settings").select("value").eq("key", "timezone").maybeSingle(),
      ]);
      setPeople((peopleRows ?? []) as PersonOption[]);
      const value = (tzRow as { value?: unknown } | null)?.value;
      if (typeof value === "string" && value) setTimezone(value);
    })();
  }, [open, loaded]);

  const domainOptions = useMemo(
    () => domains.map((d) => ({ id: d.id, slug: d.slug, name: d.name })),
    [domains],
  );
  const projectOptions = useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name, domain_id: p.domain_id })),
    [projects],
  );
  const today = useMemo(() => localToday(timezone), [timezone]);
  const parsed = useMemo(
    () =>
      parseSafely(query, {
        domains: domainOptions,
        projects: projectOptions,
        people,
        today,
      }),
    [query, domainOptions, projectOptions, people, today],
  );

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const add = () => {
    const title = parsed.title.trim();
    if (!title) return;
    const project = projectOptions.find((p) => p.id === parsed.project_id);
    const domainId = parsed.domain_id ?? project?.domain_id;
    setOpen(false);
    setQuery("");
    startTransition(async () => {
      const res = await createTask({
        title,
        domain_id: domainId,
        project_id: parsed.project_id ?? null,
        person_id: parsed.person_id ?? null,
        priority: parsed.priority,
        due_date: parsed.due_date ?? null,
        due_time: parsed.due_time ?? null,
        scheduled_date: parsed.scheduled_date ?? null,
      });
      toast(res.ok ? "Task added" : res.error);
      if (res.ok) router.refresh();
    });
  };

  // Smart add closes the palette straight away and reports through the toast,
  // so a sentence with several to-dos in it does not hold the palette open
  // while the capture pipeline files it.
  const addSmart = () => {
    const raw = query.trim();
    if (!raw) return;
    setOpen(false);
    setQuery("");
    toast("Filing…");
    void smartAdd(raw);
  };

  return (
    <>
      <ToastHost />
      {open ? (
        <div className="fixed inset-0 z-50 bg-ink/20 pt-[15vh]" onClick={() => setOpen(false)}>
          <div className="mx-auto w-full max-w-[680px] px-4" onClick={(e) => e.stopPropagation()}>
            <Command
              shouldFilter
              className="overflow-hidden rounded-card border border-line bg-paper shadow-whisper"
            >
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder='Search, or add: "Send memo to Bernhard fri #tarifa !high"'
                className="h-14 w-full border-b border-line bg-transparent px-[18px] text-[17px] outline-none placeholder:text-ink-3"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  // ⌘⏎ adds the parsed task without having to walk the list to
                  // the "Add task" row; plain ⏎ still runs whatever is selected.
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && parsed.title.trim()) {
                    e.preventDefault();
                    add();
                  }
                }}
              />
              {query.trim() ? (
                // Canvas 2j: the parse preview sits on the raised surface.
                <div className="border-b border-line bg-raise px-[18px] py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="section-label">Create task</p>
                    <button
                      type="button"
                      onClick={addSmart}
                      className="-my-2 h-11 shrink-0 whitespace-nowrap px-1 text-[13px] font-medium text-accent"
                    >
                      Smart add
                    </button>
                  </div>
                  <p className="mt-1.5 truncate text-[15px] font-medium text-ink">
                    {parsed.title || "…"}
                  </p>
                  <ParsedChips
                    parsed={parsed}
                    domains={domainOptions}
                    projects={projectOptions}
                    people={people}
                    today={today}
                    className="mt-2"
                  />
                </div>
              ) : null}
              <Command.List className="max-h-72 overflow-y-auto py-2">
                {query.trim() ? (
                  <Command.Item value={`add ${query}`} onSelect={add} className={ITEM_CLASS}>
                    Add task: “{parsed.title || query}”
                  </Command.Item>
                ) : null}
                {query.trim() ? (
                  <Command.Item value={`smart add ${query}`} onSelect={addSmart} className={ITEM_CLASS}>
                    Smart add: let AI split and date “{query}”
                  </Command.Item>
                ) : null}
                {query.trim() ? (
                  <Command.Item
                    value={`search ${query}`}
                    onSelect={() => go(`/search?q=${encodeURIComponent(query)}`)}
                    className={ITEM_CLASS}
                  >
                    Search everything for “{query}”
                  </Command.Item>
                ) : null}
                <Command.Group
                  heading="Go to"
                  className="[&_[cmdk-group-heading]]:section-label [&_[cmdk-group-heading]]:px-[18px] [&_[cmdk-group-heading]]:py-1.5"
                >
                  {NAV.map(([href, label]) => (
                    <Command.Item
                      key={href}
                      value={label}
                      onSelect={() => go(href)}
                      className={ITEM_CLASS}
                    >
                      {label}
                    </Command.Item>
                  ))}
                  {domains.map((d) => (
                    <Command.Item
                      key={d.id}
                      value={`domain ${d.name}`}
                      onSelect={() => go(`/domains/${d.slug}`)}
                      className={ITEM_CLASS}
                    >
                      {d.name}
                    </Command.Item>
                  ))}
                  {projects.map((p) => (
                    <Command.Item
                      key={p.id}
                      value={`project ${p.name}`}
                      onSelect={() => go(`/projects/${p.id}`)}
                      className={ITEM_CLASS}
                    >
                      {p.name}
                    </Command.Item>
                  ))}
                </Command.Group>
              </Command.List>
              {/* Canvas 2j: the syntax and the keys that work here, on a
                  hairline. ink-2 because both carry information (§8). */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-[18px] py-2 text-[11px] text-ink-2">
                <span className="font-mono">#domain/project · @person · !priority · ~date</span>
                <span className="font-mono">↑↓ move · ⏎ open · ⌘⏎ add task · esc close</span>
              </div>
            </Command>
          </div>
        </div>
      ) : null}
    </>
  );
}
