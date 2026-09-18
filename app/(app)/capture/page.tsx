import { createClient } from "@/lib/supabase/server";
import { CapturePanel } from "@/components/capture/capture-panel";
import { CaptureHistory } from "@/components/capture/history";
import type { Capture, Domain, Project } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * /capture — full-screen on mobile, the same page as a centred panel on
 * desktop (⌘J routes here). DESIGN_BRIEF §5.2. With ?capture=<id> (the
 * "Review" action on the global record sheet's toast) the panel opens on that
 * capture's result view instead of the idle recorder.
 */
export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ capture?: string | string[] }>;
}) {
  const { capture } = await searchParams;
  const initialCaptureId = typeof capture === "string" && capture ? capture : null;

  const supabase = await createClient();
  const [{ data: domains }, { data: projects }, { data: captures }] = await Promise.all([
    supabase.from("domains").select("*").order("sort_order"),
    supabase.from("projects").select("*").eq("status", "active").order("name"),
    supabase.from("captures").select("*").order("created_at", { ascending: false }).limit(8),
  ]);

  return (
    <div className="pt-6 md:mx-auto md:max-w-[560px]">
      <h1 className="sr-only">Capture</h1>
      <CapturePanel
        domains={(domains ?? []) as Domain[]}
        projects={(projects ?? []) as Project[]}
        initialCaptureId={initialCaptureId}
      />
      <CaptureHistory captures={(captures ?? []) as Capture[]} />
    </div>
  );
}
