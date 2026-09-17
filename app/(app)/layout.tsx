import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomTabs } from "@/components/shell/bottom-tabs";
import { Sidebar } from "@/components/shell/sidebar";
import { CommandPaletteLazy } from "@/components/shell/command-palette-lazy";
import { GlobalRecord } from "@/components/capture/global-record";
import { AppLifecycle } from "@/components/shell/app-lifecycle";
import type { Domain, Project } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: domains }, { data: projects }, { count: queueCount }] = await Promise.all([
    supabase.from("domains").select("*").order("sort_order"),
    supabase.from("projects").select("*").eq("status", "active").order("sort_order"),
    supabase.from("suggestions").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  return (
    <div className="min-h-dvh md:flex">
      <Sidebar
        domains={(domains ?? []) as Domain[]}
        projects={(projects ?? []) as Project[]}
        queueCount={queueCount ?? 0}
      />
      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-[880px] px-4 pb-28 pt-safe md:px-8 md:pb-12">
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
