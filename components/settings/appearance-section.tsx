"use client";

import { useState, useTransition } from "react";
import { saveTheme } from "@/app/(app)/settings/actions";
import { SettingsSection } from "@/components/settings/ui";
import { cn } from "@/lib/utils";

type Theme = "system" | "light" | "dark";
const OPTIONS: Theme[] = ["system", "light", "dark"];

/**
 * Theme (DESIGN_BRIEF §3: dark mode exists because the phone is used in bed).
 * The choice is stored in settings so it follows Joshua between devices, and
 * mirrored into localStorage so the pre-paint script in the root layout can
 * apply it without a flash.
 */
export function AppearanceSection({ theme }: { theme: Theme }) {
  const [current, setCurrent] = useState<Theme>(theme);
  const [, start] = useTransition();

  const choose = (next: Theme) => {
    setCurrent(next);
    apply(next);
    start(async () => {
      await saveTheme({ theme: next });
    });
  };

  return (
    <SettingsSection title="Appearance">
      <div className="inline-flex rounded-card border border-line bg-paper-2 p-1">
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => choose(option)}
            className={cn(
              "h-11 min-w-24 rounded-[7px] px-4 text-[14px] capitalize",
              current === option ? "bg-accent-soft text-ink" : "text-ink-2",
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </SettingsSection>
  );
}

function apply(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem("lifeos-theme");
    else localStorage.setItem("lifeos-theme", theme);
    const dark =
      theme === "dark" ||
      (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch {
    // Private mode / storage disabled: the class still toggles for this session.
  }
}
