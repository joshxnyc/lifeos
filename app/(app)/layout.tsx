import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomTabs } from "@/components/shell/bottom-tabs";
import { Sidebar } from "@/components/shell/sidebar";
import { CommandPaletteLazy } from "@/components/shell/command-palette-lazy";
import { GlobalRecord } from "@/components/capture/global-record";
import { AppLifecycle } from "@/components/shell/app-lifecycle";
import { localDate } from "@/lib/time";
import { DEFAULT_SETTINGS } from "@/lib/types";
import type { Domain, Project } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: domains }, { data: projects }, { count: queueCount }, { data: tzRow }] =
    await Promise.all([
      supabase.from("domains").select("*").order("sort_order"),
      supabase.from("projects").select("*").eq("status", "active").order("sort_order"),
      supabase.from("suggestions").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("settings").select("value").eq("key", "timezone").maybeSingle(),
    ]);

  // Overdue and due-today counts for the Tasks badge. "Today" is the user's
  // local calendar day, so the timezone rides the same round trip above and
  // the two head-counts run in a second parallel pair.
  const tzValue = (tzRow as { value?: unknown } | null)?.value;
  const timezone =
    typeof tzValue === "string" && tzValue ? tzValue : DEFAULT_SETTINGS.timezone;
  const today = localDate(new Date(), timezone);
  const [{ count: overdueCount }, { count: dueTodayCount }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .lt("due_date", today),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("status", "open")
      .eq("due_date", today),
  ]);

  return (
    <div className="min-h-dvh md:flex">
      <Sidebar
        domains={(domains ?? []) as Domain[]}
        projects={(projects ?? []) as Project[]}
        queueCount={queueCount ?? 0}
        taskCount={(overdueCount ?? 0) + (dueTodayCount ?? 0)}
      />
      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-[880px] px-4 pb-28 pt-safe md:px-8 md:pb-12 xl:max-w-[1080px]">
          {children}
        </main>
      </div>
      <BottomTabs />
      <GlobalRecord />
      <AppLifecycle />
      <CommandPaletteLazy
        domains={(domains ?? []) as Domain[]}
        projects={(projects ?? []) as Project[]}
      />
    </div>
  );
}
