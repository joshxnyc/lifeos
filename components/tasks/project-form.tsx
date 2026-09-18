"use client";

// Project/area create and edit, plus Park / Close / Revive. Mirrored (Notion)
// projects are read-only here — the app never writes to Notion.

import { useState, useTransition } from "react";
import { closeProject, createProject, parkProject, reviveProject, updateProject } from "@/app/(app)/tasks/actions";
import { Sheet } from "@/components/tasks/sheet";
import { toast } from "@/components/tasks/toast";
import { Button } from "@/components/ui/button";
import type { DomainOption } from "@/components/tasks/types";
import type { Project } from "@/lib/types";

const field =
  "h-11 w-full rounded-card border border-line bg-paper-2 px-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent";

export function NewProjectButton({
  domains,
  defaultDomainId,
}: {
  domains: DomainOption[];
  defaultDomainId: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"project" | "area">("project");
  const [domainId, setDomainId] = useState(defaultDomainId);
  const [targetDate, setTargetDate] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await createProject({
        name,
        domain_id: domainId,
        kind,
        target_date: targetDate || null,
        description: description || null,
      });
      if (!res.ok) toast(res.error);
      else {
        toast(kind === "area" ? "Area created" : "Project created");
        setOpen(false);
        setName("");
        setTargetDate("");
        setDescription("");
      }
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        New project
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New project">
        <div className="flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            aria-label="Name"
            className={field}
            autoFocus
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="section-label">Kind</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "project" | "area")}
                className={field}
              >
                <option value="project">Project</option>
                <option value="area">Area</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="section-label">Domain</span>
              <select value={domainId} onChange={(e) => setDomainId(e.target.value)} className={field}>
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {kind === "project" ? (
            <label className="flex flex-col gap-1">
              <span className="section-label">Target date</span>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className={field}
              />
            </label>
          ) : null}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What is this for?"
            aria-label="Description"
            className="w-full rounded-card border border-line bg-paper-2 px-3 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          />
          <Button variant="primary" onClick={submit} disabled={pending || !name.trim()}>
            Create
          </Button>
        </div>
      </Sheet>
    </>
  );
}

export function ProjectActions({
  project,
  domains,
}: {
  project: Project;
  domains: DomainOption[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [kind, setKind] = useState<"project" | "area">(project.kind);
  const [domainId, setDomainId] = useState(project.domain_id);
  const [targetDate, setTargetDate] = useState(project.target_date ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [pending, startTransition] = useTransition();

  if (project.notion_url) return null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast(res.error ?? "That did not work.");
      else {
        toast(done);
        setOpen(false);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Edit
      </Button>
      {project.status === "active" ? (
        <Button variant="ghost" onClick={() => run(() => parkProject(project.id), "Project parked")}>
          Park
        </Button>
      ) : (
        <Button variant="ghost" onClick={() => run(() => reviveProject(project.id), "Project active again")}>
          Revive
        </Button>
      )}
      {project.status === "done" ? null : (
        <Button variant="ghost" onClick={() => run(() => closeProject(project.id), "Project closed")}>
          Close
        </Button>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="Edit project">
        <div className="flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Name"
            className={field}
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="section-label">Kind</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "project" | "area")}
                className={field}
              >
                <option value="project">Project</option>
                <option value="area">Area</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="section-label">Domain</span>
              <select value={domainId} onChange={(e) => setDomainId(e.target.value)} className={field}>
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {kind === "project" ? (
            <label className="flex flex-col gap-1">
              <span className="section-label">Target date</span>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className={field}
              />
            </label>
          ) : null}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            aria-label="Description"
            className="w-full rounded-card border border-line bg-paper-2 px-3 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          />
          <Button
            variant="primary"
            disabled={pending || !name.trim()}
            onClick={() =>
              run(
                () =>
                  updateProject(project.id, {
                    name,
                    kind,
                    domain_id: domainId,
                    target_date: targetDate || null,
                    description: description || null,
                  }),
                "Project saved",
              )
            }
          >
            Save
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
