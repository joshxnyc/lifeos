"use client";

// The palette pulls in cmdk and (via quick-add parsing) chrono-node — the
// heaviest client code in the shell. It renders nothing until ⌘K, so it is
// split out of the initial bundle and fetched right after hydration instead
// of before first paint. `ssr: false` is safe: the palette renders nothing
// while closed. The toast outlet deliberately does NOT live in it — it is
// hosted eagerly by AppLifecycle, so toasts fired before this chunk loads
// still land.
import dynamic from "next/dynamic";
import type { Domain, Project } from "@/lib/types";

const CommandPalette = dynamic(
  () => import("@/components/shell/command-palette").then((m) => m.CommandPalette),
  { ssr: false },
);

export function CommandPaletteLazy(props: { domains: Domain[]; projects: Project[] }) {
  return <CommandPalette {...props} />;
}
