"use client";

import { useMemo, useState, useTransition } from "react";
import { saveTheme, saveTimezone } from "@/app/(app)/settings/actions";
import { Panel, Row, SettingsSection, selectClass } from "@/components/settings/ui";
import { cn } from "@/lib/utils";

type Theme = "system" | "light" | "dark";
const OPTIONS: Theme[] = ["system", "light", "dark"];

// The zones Joshua actually lives between (New York, plus the European ones the
// Tarifa side sits in) come first; the platform's full list follows.
const COMMON_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Zurich",
  "Europe/Vienna",
  "Europe/Rome",
  "Europe/Athens",
  "UTC",
];

function allZones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf;
    return typeof supported === "function" ? supported("timeZone") : [];
  } catch {
    return [];
  }
}

function zoneLabel(zone: string): string {
  return zone.replace(/_/g, " ");
}

/**
 * Theme (DESIGN_BRIEF §3: dark mode exists because the phone is used in bed).
 * The choice is stored in settings so it follows Joshua between devices, and
 * mirrored into localStorage so the pre-paint script in the root layout can
 * apply it without a flash. Timezone lives here too: every job and screen reads
 * it, so it needs one place to change.
 */
export function AppearanceSection({ theme, timezone }: { theme: Theme; timezone: string }) {
  const [current, setCurrent] = useState<Theme>(theme);
  const [zone, setZone] = useState(timezone);
  const [, start] = useTransition();

  const rest = useMemo(
    () => allZones().filter((z) => !COMMON_ZONES.includes(z) && z !== timezone),
    [timezone],
  );
  const common = useMemo(
    () => (COMMON_ZONES.includes(timezone) ? COMMON_ZONES : [timezone, ...COMMON_ZONES]),
    [timezone],
  );

  const choose = (next: Theme) => {
    setCurrent(next);
    apply(next);
    start(async () => {
      await saveTheme({ theme: next });
    });
  };

  const chooseZone = (next: string) => {
    const previous = zone;
    setZone(next);
    start(async () => {
      const result = await saveTimezone({ timezone: next });
      if (!result.ok) setZone(previous);
    });
  };

  return (
    <SettingsSection title="Appearance">
      <div className="mb-4 inline-flex rounded-card border border-line bg-paper-2 p-1">
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

      <Panel>
        <Row label="Timezone" hint="Days, due dates and scheduled pushes are read in this zone.">
          <select
            aria-label="Timezone"
            value={zone}
            onChange={(event) => chooseZone(event.target.value)}
            className={cn(selectClass, "w-56")}
          >
            <optgroup label="Common">
              {common.map((z) => (
                <option key={z} value={z}>
                  {zoneLabel(z)}
                </option>
              ))}
            </optgroup>
            {rest.length > 0 ? (
              <optgroup label="All">
                {rest.map((z) => (
                  <option key={z} value={z}>
                    {zoneLabel(z)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </Row>
      </Panel>
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
