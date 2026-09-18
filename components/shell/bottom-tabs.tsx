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
  MessageCircle,
  ClipboardList,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { requestRecord } from "@/components/capture/global-record";

const moreLinks = [
  // The mic button records in place, so the full capture screen (text mode,
  // history, retries) lives here.
  { href: "/capture", label: "Capture screen", icon: Mic },
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
        // Canvas: the active tab is ink at weight 600, not accent — the
        // accent is reserved for the capture button and for actions.
        "flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-[11px]",
        pathname.startsWith(href) ? "font-semibold text-ink" : "text-ink-2",
      )}
    >
      <Icon size={22} strokeWidth={1.75} />
      {label}
    </Link>
  );

  return (
    <>
      {moreOpen ? (
        <div
          className="animate-fade-in fixed inset-0 z-40 bg-ink/20 md:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="animate-sheet-up absolute inset-x-0 bottom-0 rounded-t-2xl bg-paper p-4 pb-safe shadow-whisper supports-[backdrop-filter]:bg-paper/90 supports-[backdrop-filter]:backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Canvas 2b: a grab handle over a plain hairline-separated list,
                not a grid of tiles. */}
            <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-line" aria-hidden />
            <div className="mb-20">
              {moreLinks.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className="flex min-h-11 items-center gap-3 border-b border-line py-3.5 text-[15px] text-ink last:border-b-0"
                >
                  <Icon size={18} strokeWidth={1.75} className="shrink-0 text-ink-2" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {/* Frosted chrome: solid paper stays the fallback; where backdrop-filter
          exists the bar goes translucent over blurred page content. Opacity
          stays ≥ .8 so labels keep contrast over arbitrary rows. */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-paper pt-2 pb-safe supports-[backdrop-filter]:bg-paper/80 supports-[backdrop-filter]:backdrop-blur-xl md:hidden">
        <div className="flex items-end">
          {tab("/today", "Today", CalendarCheck)}
          {tab("/tasks", "Tasks", ListChecks)}
          {/* Records in place over whatever page is open — no navigation. */}
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              requestRecord();
            }}
            aria-label="Record a capture"
            className="relative -top-[22px] mx-auto flex size-14 items-center justify-center rounded-full bg-accent text-paper shadow-whisper transition-transform active:scale-95"
          >
            <Mic size={24} />
          </button>
          {tab("/routines", "Routines", Repeat)}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={cn(
              "flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-[11px]",
              moreOpen ? "font-semibold text-ink" : "text-ink-2",
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
