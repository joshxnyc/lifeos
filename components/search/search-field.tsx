"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search as SearchIcon } from "lucide-react";

/** One field (DESIGN_BRIEF §5.8). Enter searches; the query lives in ?q=. */
export function SearchField({ initial }: { initial: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params.toString());
    if (value.trim()) next.set("q", value.trim());
    else next.delete("q");
    router.push(`/search?${next.toString()}`);
  };

  return (
    <form onSubmit={submit} className="mb-5">
      <div className="flex h-12 items-center gap-2 rounded-card bg-paper-2 px-3.5 focus-within:ring-1 focus-within:ring-accent">
        <SearchIcon className="size-4 shrink-0 text-ink-2" />
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          type="search"
          enterKeyHint="search"
          placeholder="Search tasks, notes, people and the archive"
          className="h-full w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
        />
      </div>
    </form>
  );
}
