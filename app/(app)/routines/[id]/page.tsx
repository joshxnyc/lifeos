import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { localDate } from "@/lib/time";
import { computeStreaks, completionRate } from "@/lib/domain/streaks";
import type { Domain, Routine, RoutineLog } from "@/lib/types";
import { RoutineHeatmap } from "@/components/routines/routine-heatmap";
import { AdherenceSparkline } from "@/components/routines/adherence-sparkline";
import { RoutineForm } from "@/components/routines/routine-form";
import { DeleteRoutine } from "@/components/routines/delete-routine";
import { DotStrip } from "@/components/routines/dot-strip";
import { dayStatus, lastDates, scheduleLine, shortTime } from "@/components/routines/format";

const WEEKS = 12;

// Canvas 1i: the number leads at 34px Fraunces, the label sits under it.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="display-number">{value}</p>
      <p className="mt-1 text-[12px] text-ink-2">{label}</p>
    </div>
  );
}

export default async function RoutineDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: routineRow }, { data: logRows }, { data: domainRows }] = await Promise.all([
    supabase.from("routines").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("routine_logs")
      .select("date, status")
      .eq("routine_id", id)
      .order("date", { ascending: true }),
    supabase.from("domains").select("*").order("sort_order"),
  ]);

  const routine = routineRow as Routine | null;
  if (!routine) notFound();

  const logs = (logRows ?? []) as Pick<RoutineLog, "date" | "status">[];
  const domains = (domainRows ?? []) as Domain[];
  const settings = await getSettings(supabase, user.id);
  const today = localDate(new Date(), settings.timezone);

  const byDate = new Map(logs.map((l) => [l.date, l.status]));
  const { current, best } = computeStreaks(logs, routine.schedule_days, today);
  const rate28 = completionRate(logs, routine.schedule_days, today, 28);
  const doneCount = logs.filter((l) => l.status === "done").length;
  const skippedCount = logs.filter((l) => l.status === "skipped").length;

  const strip = lastDates(today, 28).map((date) => ({
    date,
    status: dayStatus(date, today, routine.schedule_days, byDate),
  }));

  return (
    <>
      <Link
        href="/routines"
        className="-ml-2 mt-4 inline-flex h-11 items-center gap-1 pr-3 pl-2 text-[15px] text-accent"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Routines
      </Link>

      <header className="mt-1 mb-6">
        <h1 className="display-title">
          {routine.emoji ? <span className="mr-2">{routine.emoji}</span> : null}
          {routine.name}
        </h1>
        <p className="tabular mt-1 text-[13px] text-ink-2">
          {scheduleLine(routine.schedule_days, routine.reminder_time)}
          {routine.reminder_time && routine.nudge_enabled
            ? ` · nudge at ${shortTime(routine.reminder_time)} +${routine.grace_minutes}m`
            : ""}
          {!routine.active ? " · inactive" : ""}
        </p>
      </header>

      <section className="mb-8 grid grid-cols-3 gap-4">
        <Stat label="Current streak" value={String(current)} />
        <Stat label="Best streak" value={String(best)} />
        <Stat label="28-day rate" value={`${Math.round(rate28 * 100)}%`} />
      </section>

      <section className="mb-8">
        <h2 className="section-label mb-2.5">Last 28 days</h2>
        <DotStrip days={strip} />
        <p className="tabular mt-3 text-[13px] text-ink-2">
          {doneCount} done · {skippedCount} skipped · {logs.length} days logged in total
        </p>
      </section>

      <section className="mb-8">
        <h2 className="section-label mb-2.5">By weekday · last {WEEKS} weeks</h2>
        <RoutineHeatmap
          today={today}
          scheduleDays={routine.schedule_days}
          logs={logs}
          weeks={WEEKS}
        />
      </section>

      <section className="mb-8">
        <h2 className="section-label mb-2">Adherence by week</h2>
        <AdherenceSparkline
          today={today}
          scheduleDays={routine.schedule_days}
          logs={logs}
          weeks={WEEKS}
        />
      </section>

      <section className="mb-8 border-t border-line pt-6">
        <h2 className="section-label mb-3">Settings</h2>
        <RoutineForm
          domains={domains.map((d) => ({ id: d.id, name: d.name }))}
          initial={{
            id: routine.id,
            name: routine.name,
            emoji: routine.emoji,
            schedule_days: routine.schedule_days,
            reminder_time: shortTime(routine.reminder_time),
            grace_minutes: routine.grace_minutes,
            nudge_enabled: routine.nudge_enabled,
            domain_id: routine.domain_id,
            write_to_calendar: routine.write_to_calendar,
            active: routine.active,
          }}
        />
      </section>

      <section className="border-t border-line pt-6">
        <h2 className="section-label mb-3">Danger zone</h2>
        <DeleteRoutine routineId={routine.id} logCount={logs.length} />
      </section>
    </>
  );
}
