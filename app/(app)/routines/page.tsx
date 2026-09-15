import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { localDate, localDayOfWeek } from "@/lib/time";
import { computeStreaks, completionRate } from "@/lib/domain/streaks";
import type { Domain, Routine, RoutineLog } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { RoutineTile } from "@/components/routines/routine-tile";
import { AddRoutineButton } from "@/components/routines/routine-form";
import { ActiveToggle } from "@/components/routines/active-toggle";
import { EnablePushSection } from "@/components/push/enable-push-server";
import { addDaysStr, dayStatus, lastDates, scheduleLine } from "@/components/routines/format";

const STRIP_DAYS = 28;
const HISTORY_DAYS = 120; // enough for a streak number without loading everything

export default async function RoutinesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const settings = await getSettings(supabase, user.id);
  const now = new Date();
  const today = localDate(now, settings.timezone);
  const dow = localDayOfWeek(now, settings.timezone);

  const [{ data: routineRows }, { data: logRows }, { data: domainRows }] = await Promise.all([
    supabase.from("routines").select("*").order("sort_order").order("created_at"),
    supabase
      .from("routine_logs")
      .select("routine_id, date, status")
      .gte("date", addDaysStr(today, -(HISTORY_DAYS - 1))),
    supabase.from("domains").select("*").order("sort_order"),
  ]);

  const routines = (routineRows ?? []) as Routine[];
  const logs = (logRows ?? []) as Pick<RoutineLog, "routine_id" | "date" | "status">[];
  const domains = (domainRows ?? []) as Domain[];
  const domainById = new Map(domains.map((d) => [d.id, d]));
  const domainOptions = domains.map((d) => ({ id: d.id, name: d.name }));

  const logsByRoutine = new Map<string, Pick<RoutineLog, "date" | "status">[]>();
  for (const log of logs) {
    const list = logsByRoutine.get(log.routine_id) ?? [];
    list.push({ date: log.date, status: log.status });
    logsByRoutine.set(log.routine_id, list);
  }

  const stripDates = lastDates(today, STRIP_DAYS);

  const tiles = routines
    .filter((r) => r.active && r.schedule_days.includes(dow))
    .map((r) => {
      const routineLogs = logsByRoutine.get(r.id) ?? [];
      const byDate = new Map(routineLogs.map((l) => [l.date, l.status]));
      const domain = r.domain_id ? domainById.get(r.domain_id) : undefined;
      return {
        routine: r,
        domainColor: domain?.color ?? null,
        todayStatus: byDate.get(today) ?? null,
        streak: computeStreaks(routineLogs, r.schedule_days, today).current,
        rate: completionRate(routineLogs, r.schedule_days, today, STRIP_DAYS),
        days: stripDates.map((date) => ({
          date,
          status: dayStatus(date, today, r.schedule_days, byDate),
        })),
      };
    });

  const doneToday = tiles.filter((t) => t.todayStatus === "done").length;

  if (routines.length === 0) {
    return (
      <>
        <PageHeader title="Routines" />
        <EmptyState
          line="No routines yet. Add the ones you want tracked."
          action={<AddRoutineButton domains={domainOptions} />}
        />
        <section className="mt-8 border-t border-line pt-6">
          <h2 className="section-label">Notifications</h2>
          <p className="mb-3 mt-1 text-[14px] text-ink-2">
            Reminders and missed nudges arrive as push. Turn them on once per device.
          </p>
          <EnablePushSection />
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Routines"
        subtitle={
          tiles.length > 0
            ? `${doneToday} of ${tiles.length} logged today`
            : "Nothing scheduled today"
        }
        actions={<AddRoutineButton domains={domainOptions} />}
      />

      {tiles.length > 0 ? (
        <section className="mb-8">
          <h2 className="section-label mb-2">Today</h2>
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((t) => (
              <RoutineTile
                key={t.routine.id}
                id={t.routine.id}
                name={t.routine.name}
                emoji={t.routine.emoji}
                domainColor={t.domainColor}
                today={today}
                todayStatus={t.todayStatus}
                streak={t.streak}
                rate={t.rate}
                days={t.days}
              />
            ))}
          </div>
          <p className="mt-2 text-[12px] text-ink-2">
            Tap to log done. Press and hold to skip today.
          </p>
        </section>
      ) : null}

      <section>
        <h2 className="section-label mb-1">All routines</h2>
        <ul className="divide-y divide-line">
          {routines.map((r) => {
            const domain = r.domain_id ? domainById.get(r.domain_id) : undefined;
            return (
              <li key={r.id} className="flex items-center gap-2 py-1.5">
                <Link
                  href={`/routines/${r.id}`}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 border-l-[3px] pl-2"
                  style={{ borderLeftColor: domain?.color ?? "transparent" }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-ink">
                      {r.emoji ? <span className="mr-1.5">{r.emoji}</span> : null}
                      {r.name}
                    </span>
                    <span className="tabular block text-[12px] text-ink-2">
                      {scheduleLine(r.schedule_days, r.reminder_time)}
                      {r.reminder_time && r.nudge_enabled ? ` · nudge +${r.grace_minutes}m` : ""}
                      {!r.active ? " · inactive" : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ink-2" aria-hidden />
                </Link>
                <ActiveToggle routineId={r.id} active={r.active} name={r.name} />
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
