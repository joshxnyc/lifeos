import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/components/tasks/format";
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
      <PageHeader
        title="Weekly reviews"
        subtitle={`Week of ${formatShortDate(thisWeek)} – ${formatShortDate(addDays(thisWeek, 6))}`}
      />

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
        <section className="mt-8 grid grid-cols-3 gap-3">
          <Sparkline
            label="Completion"
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
        <h2 className="section-label mb-1">Past weeks</h2>
        {history.length ? (
          // Canvas 2g: the week and whether the change was tried on one 13px
          // line, the change itself in Fraunces underneath.
          <ul>
            {history.map((review) => (
              <li key={review.id} className="border-b border-line">
                <Link
                  href={`/review/${review.week_start}/${review.status === "done" ? 5 : review.step_reached}`}
                  className="block py-3"
                >
                  <span className="flex items-baseline justify-between gap-3 text-[13px] text-ink-2">
                    <span className="tabular">
                      {formatShortDate(review.week_start)} – {formatShortDate(addDays(review.week_start, 6))}
                    </span>
                    <span
                      className={cn(
                        "shrink-0",
                        review.one_change == null
                          ? "text-ink-2"
                          : review.one_change_accepted
                            ? "text-ok"
                            : "text-danger",
                      )}
                    >
                      {review.one_change == null
                        ? review.status === "done"
                          ? "Done"
                          : `Step ${review.step_reached}`
                        : review.one_change_accepted
                          ? "Tried"
                          : "Not tried"}
                    </span>
                  </span>
                  {review.one_change ? (
                    <span className="mt-1 block font-display text-[17px] leading-[1.35] text-ink">
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
