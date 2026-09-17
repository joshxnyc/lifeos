"use client";

// ⌘K command palette: navigation, search hand-off and real quick-add (SPEC §9).
// ⌘J jumps to capture. Parsing is lib/domain/quick-add; writing is the tasks
// server action. The toast outlet lives in AppLifecycle, not here: this file
// is code-split and loads after hydration, so a toast fired early (an offline
// replay on mount) would find no listener.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { createClient } from "@/lib/supabase/client";
import { createTask } from "@/app/(app)/tasks/actions";
import { ParsedChips, parseSafely } from "@/components/tasks/quick-add";
import { toast } from "@/components/tasks/toast";
import { useSmartAdd } from "@/components/capture/use-smart-add";
import { requestRecord } from "@/components/capture/global-record";
import type { Domain, Note, Person, Project, Task } from "@/lib/types";
import type { PersonOption } from "@/components/tasks/types";

type TaskHit = Pick<Task, "id" | "title" | "status" | "due_date">;
type NoteHit = Pick<Note, "id" | "title">;
type PersonHit = Pick<Person, "id" | "name" | "company" | "role" | "relationship">;

interface ContentResults {
  tasks: TaskHit[];
  notes: NoteHit[];
  people: PersonHit[];
}

const NO_RESULTS: ContentResults = { tasks: [], notes: [], people: [] };

/**
 * Live content search for the palette. Full-text first (websearch over the
 * generated search_vector columns); when that matches nothing — stopword-only
 * queries produce an empty tsquery, and a half-typed word never stems — fall
 * back to ilike on title/name so prefix typing still finds things.
 */
async function searchContent(raw: string, signal: AbortSignal): Promise<ContentResults> {
  const supabase = createClient();
  const run = async (mode: "fts" | "ilike"): Promise<ContentResults> => {
    let tasks = supabase.from("tasks").select("id, title, status, due_date");
    let notes = supabase.from("notes").select("id, title");
    let people = supabase.from("people").select("id, name, company, role, relationship");
    if (mode === "fts") {
      tasks = tasks.textSearch("search_vector", raw, { type: "websearch" });
      notes = notes.textSearch("search_vector", raw, { type: "websearch" });
      people = people.textSearch("search_vector", raw, { type: "websearch" });
    } else {
      const like = `%${raw.replace(/[%_\\]/g, "\\$&")}%`;
      tasks = tasks.ilike("title", like);
      notes = notes.ilike("title", like);
      people = people.ilike("name", like);
    }
    const [t, n, p] = await Promise.all([
      tasks.order("updated_at", { ascending: false }).limit(6).abortSignal(signal),
      notes.order("updated_at", { ascending: false }).limit(4).abortSignal(signal),
      people.order("last_contact_at", { ascending: false, nullsFirst: false }).limit(4).abortSignal(signal),
    ]);
    return {
      tasks: (t.data ?? []) as TaskHit[],
      notes: (n.data ?? []) as NoteHit[],
      people: (p.data ?? []) as PersonHit[],
    };
  };
  const fts = await run("fts");
  if (fts.tasks.length || fts.notes.length || fts.people.length) return fts;
  return run("ilike");
}

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

const GROUP_CLASS =
  "[&_[cmdk-group-heading]]:section-label [&_[cmdk-group-heading]]:px-[18px] [&_[cmdk-group-heading]]:py-1.5";

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
  const [results, setResults] = useState<ContentResults>(NO_RESULTS);
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

  // Deep search: debounce, then query content from the browser. The abort on
  // cleanup cancels the in-flight fetch, so a stale response can never land
  // after a newer keystroke — and nothing here blocks typing.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setResults(NO_RESULTS);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchContent(q, controller.signal)
        .then((r) => {
          if (!controller.signal.aborted) setResults(r);
        })
        .catch(() => {
          // Aborted or offline: keep whatever is showing rather than flicker.
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

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

  // cmdk's own filter would score async content rows against the query text
  // and drop them (their values are ids, not the matched content), so the
  // palette filters for itself: shouldFilter is off and nav rows are matched
  // here by substring, the way the built-in filter effectively did.
  const navQ = query.trim().toLowerCase();
  const navRows = NAV.filter(([, label]) => !navQ || label.toLowerCase().includes(navQ));
  const domainRows = domains.filter(
    (d) => !navQ || `domain ${d.name}`.toLowerCase().includes(navQ),
  );
  const projectRows = projects.filter(
    (p) => !navQ || `project ${p.name}`.toLowerCase().includes(navQ),
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
      {open ? (
        <div
          className="animate-fade-in fixed inset-0 z-50 bg-ink/20 pt-[15vh]"
          onClick={() => setOpen(false)}
        >
          <div className="mx-auto w-full max-w-[680px] px-4" onClick={(e) => e.stopPropagation()}>
            <Command
              shouldFilter={false}
              className="animate-pop-in overflow-hidden rounded-card border border-line bg-paper shadow-whisper supports-[backdrop-filter]:bg-paper/90 supports-[backdrop-filter]:backdrop-blur-xl"
            >
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder='Search, or add: "Send memo to Bernhard Friday, high priority"'
                className="h-14 w-full border-b border-line bg-transparent px-[18px] text-[17px] outline-none placeholder:text-ink-3"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  // ⌘⏎ smart-adds without having to walk the list to the
                  // "Add" row; plain ⏎ still runs whatever is selected.
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && query.trim()) {
                    e.preventDefault();
                    addSmart();
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
                      onClick={add}
                      className="-my-2 h-11 shrink-0 whitespace-nowrap px-1 text-[13px] font-medium text-accent"
                    >
                      Add as typed
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
                  <Command.Item value={`add ${query}`} onSelect={addSmart} className={ITEM_CLASS}>
                    Add: “{query}” — AI splits to-dos and reads dates
                  </Command.Item>
                ) : null}
                {query.trim() ? (
                  <Command.Item value={`add as typed ${query}`} onSelect={add} className={ITEM_CLASS}>
                    Add exactly as typed: “{parsed.title || query}”
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
                {!query.trim() ? (
                  <Command.Item
                    value="record a capture"
                    onSelect={() => {
                      setOpen(false);
                      requestRecord();
                    }}
                    className={ITEM_CLASS}
                  >
                    Record a capture
                  </Command.Item>
                ) : null}
                {results.tasks.length ? (
                  <Command.Group heading="Tasks" className={GROUP_CLASS}>
                    {results.tasks.map((t) => (
                      <Command.Item
                        key={t.id}
                        value={`task-${t.id}`}
                        onSelect={() => go(`/tasks?task=${t.id}`)}
                        className={ITEM_CLASS}
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          <span className="shrink-0 text-[12px] text-ink-2">
                            {t.status === "done" ? "Done" : t.status === "dropped" ? "Dropped" : t.due_date ? `due ${t.due_date}` : "Open"}
                          </span>
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                ) : null}
                {results.notes.length ? (
                  <Command.Group heading="Notes" className={GROUP_CLASS}>
                    {results.notes.map((n) => (
                      <Command.Item
                        key={n.id}
                        value={`note-${n.id}`}
                        onSelect={() => go(`/notes/${n.id}`)}
                        className={ITEM_CLASS}
                      >
                        <span className="block truncate">{n.title || "Untitled"}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                ) : null}
                {results.people.length ? (
                  <Command.Group heading="People" className={GROUP_CLASS}>
                    {results.people.map((p) => (
                      <Command.Item
                        key={p.id}
                        value={`person-${p.id}`}
                        onSelect={() => go(`/people/${p.id}`)}
                        className={ITEM_CLASS}
                      >
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          <span className="shrink-0 truncate text-[12px] text-ink-2">
                            {[p.relationship, p.company, p.role].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                ) : null}
                {navRows.length + domainRows.length + projectRows.length > 0 ? (
                  <Command.Group heading="Go to" className={GROUP_CLASS}>
                    {navRows.map(([href, label]) => (
                      <Command.Item
                        key={href}
                        value={label}
                        onSelect={() => go(href)}
                        className={ITEM_CLASS}
                      >
                        {label}
                      </Command.Item>
                    ))}
                    {domainRows.map((d) => (
                      <Command.Item
                        key={d.id}
                        value={`domain ${d.name}`}
                        onSelect={() => go(`/domains/${d.slug}`)}
                        className={ITEM_CLASS}
                      >
                        {d.name}
                      </Command.Item>
                    ))}
                    {projectRows.map((p) => (
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
                ) : null}
              </Command.List>
              {/* Canvas 2j: the syntax and the keys that work here, on a
                  hairline. ink-2 because both carry information (§8). */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-[18px] py-2 text-[11px] text-ink-2">
                <span className="font-mono">#domain/project · @person · !priority · ~date</span>
                <span className="font-mono">↑↓ move · ⏎ open · ⌘⏎ add · esc close</span>
              </div>
            </Command>
          </div>
        </div>
      ) : null}
    </>
  );
}
