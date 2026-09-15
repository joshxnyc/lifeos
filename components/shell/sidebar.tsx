"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { DOMAIN_COLOR_CLASS } from "@/components/ui/domain";
import type { Domain, Project } from "@/lib/types";

export function Sidebar({
  domains,
  projects,
  queueCount,
}: {
  domains: Domain[];
  projects: Project[];
  queueCount: number;
}) {
  const pathname = usePathname();

  const item = (href: string, label: string, badge?: number) => (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between rounded-card px-3 py-1.5 text-[14px]",
        pathname === href || pathname.startsWith(`${href}/`)
          ? "bg-accent-soft text-ink"
          : "text-ink-2 hover:text-ink",
      )}
    >
      {label}
      {badge ? <span className="tabular text-[12px] text-accent">{badge}</span> : null}
    </Link>
  );

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto bg-paper-2 px-3 py-6 md:flex">
      <Link href="/today" className="display-lead mb-6 px-3">
        LifeOS
      </Link>
      <nav className="flex flex-col gap-0.5">
        {item("/today", "Today")}
        {item("/queue", "Queue", queueCount)}
        {item("/tasks", "Tasks")}
        {item("/routines", "Routines")}
        {item("/people", "People")}
        {item("/notes", "Notes")}
        {item("/review", "Review")}
      </nav>
      <div className="mt-6 flex flex-col gap-0.5">
        <p className="section-label px-3 pb-1">Domains</p>
        {domains.map((d) => (
          <div key={d.id}>
            <Link
              href={`/domains/${d.slug}`}
              className={cn(
                "flex items-center gap-2 rounded-card px-3 py-1.5 text-[14px]",
                pathname === `/domains/${d.slug}` ? "bg-accent-soft text-ink" : "text-ink-2 hover:text-ink",
              )}
            >
              <span className={cn("size-2 rounded-full", DOMAIN_COLOR_CLASS[d.slug])} />
              {d.name}
            </Link>
            {projects
              .filter((p) => p.domain_id === d.id)
              .map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className={cn(
                    "block rounded-card py-1 pl-8 pr-3 text-[13px]",
                    pathname === `/projects/${p.id}` ? "text-ink" : "text-ink-2 hover:text-ink",
                  )}
                >
                  {p.name}
                </Link>
              ))}
          </div>
        ))}
      </div>
      <div className="mt-auto pt-6">{item("/settings", "Settings")}</div>
    </aside>
  );
}
