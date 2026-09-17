import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/review/step-indicator";
import { formatShortDate } from "@/components/tasks/format";
import { ScorecardView } from "@/components/review/scorecard-view";
import { SlippedStep, type SlippedTask } from "@/components/review/slipped-step";
import { DormantStep, type DormantItem } from "@/components/review/dormant-step";
import { AheadStep, type AheadDay, type Candidate } from "@/components/review/ahead-step";
import { CoachLetter } from "@/components/review/coach-letter";
import { commitScorecard } from "@/app/(app)/review/actions";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { addDays, localDate } from "@/lib/time";
import { buildScorecard } from "@/lib/ai/pipelines/coach";
import { isDormant } from "@/lib/domain/dormancy";
import { daysSinceContact, isFollowUpOverdue } from "@/lib/people";
import { daysSince } from "@/components/queue/relative-time";
import type { CalendarEvent, Domain, Person, Project, Scorecard, Task, WeeklyReview } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReviewStepPage({
  params,
}: {
  params: Promise<{ weekStart: string; step: string }>;
}) {
  const { weekStart, step: stepParam } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) notFound();
  const step = Number(stepParam);
  if (!Number.isInteger(step) || step < 1 || step > 5) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;
  const settings = await getSettings(supabase, userId);
  const tz = settings.timezone;
  const now = new Date();
  const today = localDate(now, tz);
  const weekEnd = addDays(weekStart, 6);

  const { data: reviewRow } = await supabase
    .from("weekly_reviews")
    .select("*")
    .eq("week_start", weekStart)
    .maybeSingle();
  if (!reviewRow) redirect("/review");
  const review = reviewRow as WeeklyReview;

  const { data: domainRows } = await supabase.from("domains").select("id, name, slug").order("sort_order");
  const domains = (domainRows ?? []) as Pick<Domain, "id" | "name" | "slug">[];
  const domainName = new Map(domains.map((d) => [d.id, d.name]));
  const domainSlug = new Map(domains.map((d) => [d.id, d.slug]));

  return (
    <div className="pb-16">
      {/* Canvas 1m–1q: an accent "Save and exit" and the week on one line;
          the step indicator names the step, so there is no screen title. */}
      <div className="flex items-center justify-between gap-3 pt-4">
        <Link href="/review" className="flex min-h-11 items-center text-[15px] text-accent">
          Save and exit
        </Link>
        <span className="tabular text-[13px] text-ink-2">
          {formatShortDate(weekStart)} – {formatShortDate(weekEnd)}
        </span>
      </div>

      <StepIndicator weekStart={weekStart} step={step} reached={Math.max(review.step_reached, step)} />

      {step === 1 ? await renderScorecard() : null}

      {step === 2 ? await renderSlipped() : null}
      {step === 3 ? await renderDormant() : null}
      {step === 4 ? await renderAhead() : null}

      {step === 5 ? (
        <section>
          <h1 className="sr-only">Coach</h1>
          <CoachLetter
            weekStart={weekStart}
            read={review.coach_text}
            oneChange={review.one_change}
            accepted={review.one_change_accepted}
            model={review.coach_model}
          />
        </section>
      ) : null}
    </div>
  );

  // -------------------------------------------------------------------------

  async function renderScorecard() {
    let scorecard: Scorecard | null =
      review.status === "done" && review.scorecard ? review.scorecard : null;
    let failure: string | null = null;
    if (!scorecard) {
      try {
        scorecard = await buildScorecard(supabase, userId, weekStart);
      } catch (err) {
        failure = err instanceof Error ? err.message : "The numbers could not be computed.";
      }
    }

    if (!scorecard) {
      return (
        <section>
          <h1 className="sr-only">Scorecard</h1>
          <div className="py-10">
            <p className="display-lead">The scorecard failed to compute.</p>
            {failure ? <p className="mt-2 text-[13px] text-danger">{failure}</p> : null}
            <Link
              href={`/review/${weekStart}/1`}
              className="mt-5 inline-flex min-h-11 items-center text-[15px] text-accent"
            >
              Try again
            </Link>
          </div>
        </section>
      );
    }

    return (
      <section>
        <h1 className="sr-only">Scorecard</h1>
        {review.status !== "done" && today < weekEnd ? (
          <p className="mt-4 text-[13px] text-ink-2">
            Numbers through {formatShortDate(today)}. The week ends {formatShortDate(weekEnd)}.
          </p>
        ) : null}
        <ScorecardView scorecard={scorecard} domains={domains} />
        <form action={commitScorecard.bind(null, weekStart)} className="mt-8">
          <Button type="submit" variant="primary">
            Continue
          </Button>
        </form>
      </section>
    );
  }

  async function renderSlipped() {
    const decided = review.slipped_decisions ?? [];
    const decidedIds = new Set(decided.map((d) => d.task_id));

    // Mid-week, only tasks already past due have slipped; a Thursday due date
    // is not a slip on Wednesday. Reviewing a past week later, everything due
    // by that week's Sunday counts.
    const overdueBefore = today <= weekEnd ? today : addDays(weekEnd, 1);
    const { data: overdueRows } = await supabase
      .from("tasks")
      .select("*")
      .eq("status", "open")
      .eq("is_mirror", false)
      .not("due_date", "is", null)
      .lt("due_date", overdueBefore)
      .order("due_date", { ascending: true });

    const overdue = ((overdueRows ?? []) as Task[]).filter((t) => !decidedIds.has(t.id));

    const projectIds = [...new Set(overdue.map((t) => t.project_id).filter(Boolean))] as string[];
    const personIds = [...new Set(overdue.map((t) => t.person_id).filter(Boolean))] as string[];
    const sourceIds = [...new Set(overdue.map((t) => t.source_item_id).filter(Boolean))] as string[];

    const [{ data: projects }, { data: peopleOnTasks }, { data: sources }, { data: allPeople }] =
      await Promise.all([
        projectIds.length
          ? supabase.from("projects").select("id, name").in("id", projectIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        personIds.length
          ? supabase.from("people").select("id, name").in("id", personIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        sourceIds.length
          ? supabase.from("source_items").select("id, title").in("id", sourceIds)
          : Promise.resolve({ data: [] as { id: string; title: string }[] }),
        supabase.from("people").select("id, name").order("name").limit(500),
      ]);

    const projectName = new Map((projects ?? []).map((p) => [p.id, p.name]));
    const personName = new Map((peopleOnTasks ?? []).map((p) => [p.id, p.name]));
    const sourceTitle = new Map((sources ?? []).map((s) => [s.id, s.title]));

    const tasks: SlippedTask[] = overdue.map((t) => ({
      id: t.id,
      title: t.title,
      due_date: t.due_date,
      domain_name: domainName.get(t.domain_id) ?? null,
      domain_slug: domainSlug.get(t.domain_id) ?? null,
      project_name: t.project_id ? (projectName.get(t.project_id) ?? null) : null,
      person_name: t.person_id ? (personName.get(t.person_id) ?? null) : null,
      source_title: t.source_item_id ? (sourceTitle.get(t.source_item_id) ?? null) : null,
      days_overdue: t.due_date
        ? Math.max(
            0,
            Math.round(
              (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${t.due_date}T00:00:00Z`).getTime()) /
                86_400_000,
            ),
          )
        : null,
    }));

    return (
      <section>
        <h1 className="sr-only">Slipped</h1>
        <SlippedStep
          weekStart={weekStart}
          today={today}
          tasks={tasks}
          people={(allPeople ?? []) as { id: string; name: string }[]}
          decided={decided.length}
        />
      </section>
    );
  }

  async function renderDormant() {
    const decided = review.dormant_decisions ?? [];
    const decidedKeys = new Set(decided.map((d) => d.project_id ?? d.person_id));

    const [{ data: projects }, { data: people }] = await Promise.all([
      supabase.from("projects").select("*").eq("status", "active"),
      supabase.from("people").select("*").not("follow_up_every_days", "is", null),
    ]);

    const dormantProjects = ((projects ?? []) as Project[])
      .filter((p) => isDormant(p.last_activity_at, settings.dormancy_days, now))
      .filter((p) => !decidedKeys.has(p.id))
      .map<DormantItem>((p) => ({
        kind: "project",
        id: p.id,
        name: p.name,
        detail: [domainName.get(p.domain_id), p.kind].filter(Boolean).join(" · "),
        quiet_for: `${daysSince(p.last_activity_at, now) ?? 0} days`,
      }));

    const lapsedPeople = ((people ?? []) as Person[])
      .filter((p) => isFollowUpOverdue(p, now))
      .filter((p) => !decidedKeys.has(p.id))
      .map<DormantItem>((p) => ({
        kind: "person",
        id: p.id,
        name: p.name,
        detail: [p.relationship, p.follow_up_every_days ? `every ${p.follow_up_every_days} days` : null]
          .filter(Boolean)
          .join(" · "),
        quiet_for: `${daysSinceContact(p, now)} days`,
      }));

    return (
      <section>
        <h1 className="sr-only">Dormant</h1>
        <DormantStep
          weekStart={weekStart}
          items={[...dormantProjects, ...lapsedPeople]}
          decided={decided.length}
        />
      </section>
    );
  }

  async function renderAhead() {
    const nextStart = addDays(weekStart, 7);
    const nextEnd = addDays(weekStart, 13);

    const [{ data: openTasks }, { data: events }, { data: suggestions }] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, due_date, domain_id, project_id")
        .eq("status", "open")
        .eq("is_mirror", false)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(200),
      supabase
        .from("calendar_events")
        .select("id, starts_at, ends_at, all_day")
        .gte("starts_at", `${nextStart}T00:00:00Z`)
        .lte("starts_at", `${addDays(nextEnd, 1)}T23:59:59Z`),
      supabase
        .from("suggestions")
        .select("id, title, kind, proposed")
        .eq("status", "pending")
        .gte("created_at", `${weekStart}T00:00:00Z`)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const tasks = (openTasks ?? []) as Pick<Task, "id" | "title" | "due_date" | "domain_id">[];
    const eventRows = ((events ?? []) as Pick<CalendarEvent, "id" | "starts_at" | "ends_at" | "all_day">[])
      .filter((e) => !e.all_day);

    const days: AheadDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(nextStart, i);
      const hours =
        Math.round(
          (eventRows
            .filter((e) => localDate(new Date(e.starts_at), tz) === date)
            .reduce((sum, e) => sum + (new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime()), 0) /
            3_600_000) *
            10,
        ) / 10;
      days.push({
        date,
        label: formatInTimeZone(new Date(`${date}T12:00:00Z`), "UTC", "EEE d"),
        hours,
        tasks: tasks.filter((t) => t.due_date === date).map((t) => ({ id: t.id, title: t.title })),
      });
    }

    const candidates: Candidate[] = [
      ...tasks.slice(0, 25).map<Candidate>((t) => ({
        type: "task",
        id: t.id,
        title: t.title,
        meta: [domainName.get(t.domain_id), t.due_date ? `due ${t.due_date}` : null]
          .filter(Boolean)
          .join(" · "),
      })),
      ...((suggestions ?? []) as { id: string; title: string; kind: string }[]).map<Candidate>((s) => ({
        type: "suggestion",
        id: s.id,
        title: s.title,
        meta: "From the queue — picking it accepts it",
      })),
    ];

    return (
      <section>
        <h1 className="sr-only">Ahead</h1>
        <AheadStep
          weekStart={weekStart}
          days={days}
          candidates={candidates}
          initial={review.week_top3 ?? []}
        />
      </section>
    );
  }
}
