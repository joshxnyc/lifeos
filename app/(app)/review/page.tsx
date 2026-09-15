import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Sparkline } from "@/components/review/sparkline";
import { onTimeRate, routineAdherence } from "@/components/review/scorecard-view";
import { openReview } from "@/app/(app)/review/actions";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { addDays, localDate, mondayOf } from "@/lib/time";
import type { Scorecard, WeeklyReview } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReviewIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const settings = await getSettings(supabase, user!.id);
  const today = localDate(new Date(), settings.timezone);
  const thisWeek = mondayOf(today);

  const { data: rows } = await supabase
    .from("weekly_reviews")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(26);

  const reviews = (rows ?? []) as WeeklyReview[];
  const current = reviews.find((r) => r.week_start === thisWeek) ?? null;
  const history = reviews.filter((r) => r.week_start !== thisWeek);

  const withScores = [...reviews]
    .filter((r): r is WeeklyReview & { scorecard: Scorecard } => Boolean(r.scorecard))
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .slice(-12);

  return (
    <>
      <PageHeader title="Weekly review" subtitle={`Week of ${thisWeek} to ${addDays(thisWeek, 6)}`} />

      <section className="rounded-card border border-line bg-paper-2 p-5">
        <p className="section-label">This week</p>
        <p className="display-lead mt-1">
          {current?.status === "done"
            ? "Reviewed."
            : current
              ? `In progress — step ${current.step_reached} of 5.`
              : "Not started."}
        </p>
        {current?.one_change ? (
          <p className="mt-2 text-[14px] text-ink-2">One change: {current.one_change}</p>
        ) : null}
        <form action={openReview.bind(null, thisWeek)} className="mt-4">
          <Button type="submit" variant="primary">
            {current?.status === "done" ? "Open review" : current ? "Continue review" : "Start review"}
          </Button>
        </form>
      </section>

      {withScores.length > 1 ? (
        <section className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Sparkline
            label="Completed"
            values={withScores.map((r) => r.scorecard.total.completed)}
          />
          <Sparkline
            label="On time"
            suffix="%"
            values={withScores.map((r) => onTimeRate(r.scorecard))}
          />
          <Sparkline
            label="Adherence"
            suffix="%"
            values={withScores.map((r) => routineAdherence(r.scorecard))}
          />
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="section-label mb-2">History</h2>
        {history.length ? (
          <ul className="border-t border-line">
            {history.map((review) => (
              <li key={review.id} className="border-b border-line">
                <Link
                  href={`/review/${review.week_start}/${review.status === "done" ? 5 : review.step_reached}`}
                  className="block py-3"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] text-ink tabular">Week of {review.week_start}</span>
                    <span className="shrink-0 text-[12px] text-ink-2 tabular">
                      {review.scorecard
                        ? `${review.scorecard.total.completed} completed`
                        : review.status === "done"
                          ? "done"
                          : `step ${review.step_reached}`}
                    </span>
                  </span>
                  {review.one_change ? (
                    <span className="mt-0.5 block text-[13px] text-ink-2">
                      {review.one_change_accepted ? "✓ " : ""}
                      {review.one_change}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-ink-2">No past reviews yet.</p>
        )}
      </section>
    </>
  );
}
