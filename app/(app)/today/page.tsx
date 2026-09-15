import Link from "next/link";
import { fromZonedTime } from "date-fns-tz";
import { createClient, currentUserId } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { addDays, localDate, localDayOfWeek, localTime, mondayOf } from "@/lib/time";
import { computeStreaks } from "@/lib/domain/streaks";
import { formatLongDate } from "@/components/tasks/format";
import { TaskList } from "@/components/tasks/task-list";
import { TopItemCard } from "@/components/today/top-item-card";
import { ScheduleStrip, type ScheduleEvent } from "@/components/today/schedule-strip";
import { RoutinesRow, type RoutinePillData } from "@/components/today/routines-row";
import { RightRail } from "@/components/today/right-rail";
import {
  TASK_SELECT,
  groupToday,
  loadQuickAddContext,
  loadTodayTasks,
  toTaskView,
  toTaskViews,
} from "@/app/(app)/tasks/queries";
import type {
  CalendarEvent,
  ConnectedAccount,
  DailyPlan,
  Routine,
  RoutineLog,
} from "@/lib/types";
import type { TaskView } from "@/components/tasks/types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function TodayPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const justFinishedReview = params.review === "done";
  const supabase = await createClient();
  const userId = await currentUserId();
  const settings = await getSettings(supabase, userId ?? "");
  const tz = settings.timezone;
  const now = new Date();
  const today = localDate(now, tz);
  const dow = localDayOfWeek(now, tz);
  const nowHHmm = localTime(now, tz);
  const dayStart = fromZonedTime(`${today}T00:00:00`, tz).toISOString();
  const dayEnd = fromZonedTime(`${addDays(today, 1)}T00:00:00`, tz).toISOString();

  const [
    todayTasks,
    { domains, projects },
    { data: planRow },
    { data: eventRows },
    { count: calendarEventCount },
    { count: queueCount },
    { data: accountRows },
    { data: routineRows },
    { data: routineLogRows },
    { data: upcomingRows },
    { data: reviewRow },
  ] = await Promise.all([
    loadTodayTasks(supabase, today),
    loadQuickAddContext(supabase),
    supabase.from("daily_plans").select("*").eq("date", today).maybeSingle(),
    supabase
      .from("calendar_events")
      .select("*, connected_accounts(default_domain_id)")
      .gte("starts_at", dayStart)
      .lt("starts_at", dayEnd)
      .neq("status", "cancelled")
      .order("starts_at"),
    supabase.from("calendar_events").select("id", { count: "exact", head: true }),
    supabase
      .from("suggestions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("connected_accounts")
      .select("id, provider, status, writable_calendar_id, default_domain_id"),
    supabase
      .from("routines")
      .select("*")
      .eq("active", true)
      .contains("schedule_days", [dow])
      .order("sort_order"),
    supabase
      .from("routine_logs")
      .select("routine_id, date, status")
      .gte("date", addDays(today, -120)),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("status", "open")
      .gt("due_date", today)
      .lte("due_date", addDays(today, 7))
      .order("due_date", { ascending: true })
      .limit(60),
    supabase
      .from("weekly_reviews")
      .select("status")
      .eq("week_start", mondayOf(today))
      .maybeSingle(),
  ]);

  // Canvas 2c: once the week's review is done, the date line says so and points
  // at the next one instead of leaving the prompt hanging around.
  const reviewDone =
    justFinishedReview || (reviewRow as { status?: string } | null)?.status === "done";
  const reviewNext = `${WEEKDAYS[settings.weekly_review_day] ?? "Sunday"} ${settings.weekly_review_time.slice(0, 5)}`;

  const domainById = new Map(domains.map((d) => [d.id, d]));
  const groups = groupToday(todayTasks, today);
  const openToday = [
    ...groups.overdue,
    ...groups.dueToday,
    ...groups.scheduledToday,
    ...groups.rollingOver,
  ];

  // --- Top item -------------------------------------------------------------
  const plan = planRow as DailyPlan | null;
  const chosenId = plan?.chosen_top_task_id ?? null;
  const proposedId = plan?.proposed_top_task_ids?.[0] ?? null;
  const topId = chosenId ?? proposedId;
  let topTask: TaskView | null = topId ? (openToday.find((t) => t.id === topId) ?? null) : null;
  if (topId && !topTask) {
    const { data } = await supabase.from("tasks").select(TASK_SELECT).eq("id", topId).maybeSingle();
    topTask = data ? toTaskView(data) : null;
  }

  const proposedTasks: TaskView[] = [];
  for (const id of plan?.proposed_top_task_ids ?? []) {
    const match = openToday.find((t) => t.id === id);
    if (match) proposedTasks.push(match);
  }
  const candidates = [
    ...proposedTasks,
    ...openToday.filter((t) => !proposedTasks.some((p) => p.id === t.id)),
  ].filter((t) => !t.is_mirror);

  const accounts = (accountRows ?? []) as Array<
    Pick<ConnectedAccount, "id" | "provider" | "status" | "writable_calendar_id" | "default_domain_id">
  >;
  const needsReauth = accounts.filter((a) => a.status === "needs_reauth");
  // Any active Google account with a designated writable calendar can hold the
  // block: calendar-write prefers the one whose default domain matches the
  // task and falls back to the first, so the button must not require a match.
  const canBlockTime = Boolean(
    topTask &&
      !topTask.is_mirror &&
      accounts.some((a) => a.provider === "google" && a.status === "active" && a.writable_calendar_id),
  );

  // --- Schedule -------------------------------------------------------------
  const accountDomain = new Map(accounts.map((a) => [a.id, a.default_domain_id]));
  const events: ScheduleEvent[] = (
    (eventRows ?? []) as Array<CalendarEvent & { connected_accounts: { default_domain_id: string | null } | null }>
  ).map((e) => {
    const domainId = e.connected_accounts?.default_domain_id ?? accountDomain.get(e.account_id) ?? null;
    return {
      id: e.id,
      title: e.title,
      starts_at: e.starts_at,
      ends_at: e.ends_at,
      all_day: e.all_day,
      location: e.location,
      html_link: e.html_link,
      domain_slug: domainId ? (domainById.get(domainId)?.slug ?? null) : null,
    };
  });

  // --- Routines -------------------------------------------------------------
  const logs = (routineLogRows ?? []) as Array<Pick<RoutineLog, "routine_id" | "date" | "status">>;
  const routines: RoutinePillData[] = ((routineRows ?? []) as Routine[]).map((r) => {
    const mine = logs.filter((l) => l.routine_id === r.id);
    let streak = 0;
    try {
      streak = computeStreaks(mine, r.schedule_days, today).current;
    } catch {
      streak = 0;
    }
    const todayLog = mine.find((l) => l.date === today);
    const reminder = r.reminder_time ? r.reminder_time.slice(0, 5) : null;
    let inGrace = false;
    if (reminder && !todayLog) {
      const [h = 0, m = 0] = reminder.split(":").map(Number);
      const [nh = 0, nm = 0] = nowHHmm.split(":").map(Number);
      const minutesSince = nh * 60 + nm - (h * 60 + m);
      inGrace = minutesSince >= 0 && minutesSince <= r.grace_minutes;
    }
    return {
      id: r.id,
      name: r.name,
      streak,
      status: todayLog?.status ?? null,
      inGrace,
    };
  });

  // --- Right rail -----------------------------------------------------------
  const upcomingTasks = toTaskViews(upcomingRows);
  const upcoming: Array<{ date: string; tasks: TaskView[] }> = [];
  for (const task of upcomingTasks) {
    if (!task.due_date) continue;
    const bucket = upcoming.find((u) => u.date === task.due_date);
    if (bucket) bucket.tasks.push(task);
    else upcoming.push({ date: task.due_date, tasks: [task] });
  }

  return (
    <div className="lg:flex lg:gap-8">
      <div className="min-w-0 flex-1">
        <header className="pt-6">
          <h1 className="display-title">{formatLongDate(today)}</h1>
          {reviewDone ? (
            <p className="mt-1 text-[13px] text-ink-2">Review done · next {reviewNext}</p>
          ) : null}
          {queueCount || needsReauth.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {queueCount ? (
                <Link
                  href="/queue"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 text-[13px] font-medium text-accent"
                >
                  <span className="size-1.5 rounded-full bg-accent" aria-hidden />
                  {queueCount} waiting
                </Link>
              ) : null}
              {needsReauth.length > 0 ? (
                // SyncStatusPill (canvas 1a): hairline outline, warn dot, ink-2
                // text — a problem to fix, not an alarm.
                <Link
                  href="/settings"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-2.5 text-[13px] text-ink-2"
                >
                  <span className="size-1.5 rounded-full bg-warn" aria-hidden />
                  {needsReauth.length === 1
                    ? "1 account needs reconnecting"
                    : `${needsReauth.length} accounts need reconnecting`}
                </Link>
              ) : null}
            </div>
          ) : null}
        </header>

        <div className="mt-6">
          <TopItemCard
            task={topTask}
            reason={chosenId ? null : (plan?.proposal_reason ?? null)}
            proposed={!chosenId && Boolean(proposedId)}
            candidates={candidates}
            today={today}
            canBlockTime={canBlockTime}
          />

          {calendarEventCount ? <ScheduleStrip events={events} timezone={tz} /> : null}

          <RoutinesRow routines={routines} date={today} />

          <TaskList
            sections={[
              { key: "overdue", label: "Overdue", tone: "danger", tasks: groups.overdue },
              { key: "due", label: "Due today", tasks: groups.dueToday },
              { key: "scheduled", label: "Scheduled today", tasks: groups.scheduledToday },
              { key: "rolling", label: "Rolling over", tasks: groups.rollingOver },
            ]}
            today={today}
            domains={domains}
            projects={projects}
            emptyLine="Clear. Anything on your mind?"
            emptyAction={
              <Link href="/capture" className="text-[14px] text-accent">
                Capture something
              </Link>
            }
          />
        </div>
      </div>

      <RightRail events={events} timezone={tz} upcoming={upcoming} today={today} />
    </div>
  );
}

export const dynamic = "force-dynamic";
