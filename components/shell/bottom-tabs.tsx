"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CalendarCheck,
  ListChecks,
  Mic,
  Repeat,
  MoreHorizontal,
  Inbox,
  Users,
  StickyNote,
  Search,
  ClipboardList,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const moreLinks = [
  { href: "/queue", label: "Queue", icon: Inbox },
  { href: "/people", label: "People", icon: Users },
  { href: "/notes", label: "Notes", icon: StickyNote },
  { href: "/search", label: "Search", icon: Search },
  { href: "/review", label: "Weekly Review", icon: ClipboardList },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function BottomTabs() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // The review flow hides the tab bar (DESIGN_BRIEF §5.9).
  if (/^\/review\/[^/]+\/\d/.test(pathname)) return null;

  const tab = (href: string, label: string, Icon: typeof ListChecks) => (
    <Link
      href={href}
      onClick={() => setMoreOpen(false)}
      className={cn(
        "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]",
        pathname.startsWith(href) ? "text-accent" : "text-ink-2",
      )}
    >
      <Icon size={22} strokeWidth={1.75} />
      {label}
    </Link>
  );

  return (
    <>
      {moreOpen ? (
        <div className="fixed inset-0 z-40 bg-ink/20 md:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-paper p-4 pb-safe shadow-whisper"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-20 grid grid-cols-3 gap-2">
              {moreLinks.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className="flex flex-col items-center gap-1.5 rounded-card border border-line bg-paper-2 py-4 text-[13px] text-ink"
                >
                  <Icon size={22} strokeWidth={1.75} className="text-ink-2" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-paper pb-safe md:hidden">
        <div className="flex items-center">
          {tab("/today", "Today", CalendarCheck)}
          {tab("/tasks", "Tasks", ListChecks)}
          <Link
            href="/capture"
            aria-label="Capture"
            className="relative -top-4 flex size-14 items-center justify-center rounded-full bg-accent text-white shadow-whisper"
          >
            <Mic size={24} />
          </Link>
          {tab("/routines", "Routines", Repeat)}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={cn(
              "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]",
              moreOpen ? "text-accent" : "text-ink-2",
            )}
          >
            <MoreHorizontal size={22} strokeWidth={1.75} />
            More
          </button>
        </div>
      </nav>
    </>
  );
}
