"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Pin, PinOff } from "lucide-react";
import { deleteNote, setNotePinned, updateNote } from "@/app/(app)/notes/actions";
import { cn } from "@/lib/utils";
import type { Domain, Note, Person, Project } from "@/lib/types";

const AUTOSAVE_MS = 800;

export function NoteEditor({
  note,
  domains,
  projects,
  people,
}: {
  note: Note;
  domains: Domain[];
  projects: Project[];
  people: Person[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body_md);
  const [domainId, setDomainId] = useState(note.domain_id ?? "");
  const [projectId, setProjectId] = useState(note.project_id ?? "");
  const [personId, setPersonId] = useState(note.person_id ?? "");
  const [pinned, setPinned] = useState(note.pinned);
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  // Debounced autosave (DESIGN_BRIEF §5.7): no Save button anywhere.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setSaved("saving");
    timer.current = setTimeout(async () => {
      const res = await updateNote({
        id: note.id,
        title,
        body_md: body,
        domain_id: domainId,
        project_id: projectId,
        person_id: personId,
      });
      setSaved(res.ok ? "saved" : "error");
    }, AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [title, body, domainId, projectId, personId, note.id]);

  const visibleProjects = domainId ? projects.filter((p) => p.domain_id === domainId) : projects;

  return (
    <div className="flex flex-col gap-4 pb-12 pt-6">
      <div className="flex items-start justify-between gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          className="display-title w-full bg-transparent text-ink outline-none placeholder:text-ink-3"
        />
        <button
          aria-label={pinned ? "Unpin note" : "Pin note"}
          onClick={() =>
            startTransition(async () => {
              const next = !pinned;
              setPinned(next);
              await setNotePinned(note.id, next);
            })
          }
          className={cn("flex size-11 shrink-0 items-center justify-center", pinned ? "text-accent" : "text-ink-2")}
        >
          {pinned ? <Pin className="size-5" /> : <PinOff className="size-5" />}
        </button>
      </div>

      <div className="flex items-center justify-between text-[12px] text-ink-2">
        <span>{SAVE_LABEL[saved]}</span>
        <button onClick={() => setPreview((v) => !v)} className="h-11 px-2 text-[13px] text-ink-2 hover:text-ink">
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      {preview ? (
        <div className="min-h-[40vh] rounded-card border border-line p-4 text-[15px] leading-relaxed [&_a]:text-accent [&_code]:font-mono [&_h1]:font-display [&_h1]:text-[22px] [&_h2]:font-display [&_h2]:text-[17px] [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body || "_Nothing yet._"}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write in markdown."
          className="min-h-[40vh] w-full resize-y bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
        />
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Select
          label="Domain"
          value={domainId}
          onChange={(v) => {
            setDomainId(v);
            setProjectId("");
          }}
          options={domains.map((d) => ({ value: d.id, label: d.name }))}
        />
        <Select
          label="Project"
          value={projectId}
          onChange={setProjectId}
          options={visibleProjects.map((p) => ({ value: p.id, label: p.name }))}
        />
        <Select
          label="Person"
          value={personId}
          onChange={setPersonId}
          options={people.map((p) => ({ value: p.id, label: p.name }))}
        />
        <button
          onClick={() => {
            if (!confirm("Delete this note?")) return;
            startTransition(async () => {
              await deleteNote(note.id);
              router.push("/notes");
            });
          }}
          className="ml-auto h-11 px-2 text-[13px] text-danger"
        >
          Delete
        </button>
      </footer>
    </div>
  );
}

const SAVE_LABEL: Record<string, string> = {
  idle: "",
  saving: "Saving",
  saved: "Saved",
  error: "Not saved. Check your connection.",
};

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex h-11 items-center gap-1.5 rounded-full border border-line px-3 text-[12px] text-ink-2">
      <span className="section-label">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[9rem] bg-transparent text-[13px] text-ink outline-none"
      >
        <option value="">None</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
