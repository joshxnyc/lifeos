import { jobRoute } from "@/lib/jobs";
import { enqueueNotification } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { isDormant } from "@/lib/domain/dormancy";
import { daysSinceContact, isFollowUpOverdue } from "@/lib/people";
import type { Person, Project } from "@/lib/types";

// SPEC §5 / §10 Phase 6: daily scan. Dormant projects are not stored anywhere —
// the weekly review's Dormant step reads them live — but people past their
// follow-up cadence get a push and their next_follow_up_at moved forward.
export const POST = jobRoute("dormancy-scan", async ({ supabase, userId, now }) => {
  const settings = await getSettings(supabase, userId);

  const [{ data: projects }, { data: people }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, last_activity_at")
      .eq("user_id", userId)
      .eq("status", "active"),
    supabase
      .from("people")
      .select("id, name, follow_up_every_days, last_contact_at, created_at")
      .eq("user_id", userId)
      .not("follow_up_every_days", "is", null),
  ]);

  const dormantProjects = ((projects ?? []) as Pick<Project, "id" | "name" | "last_activity_at">[]).filter(
    (p) => isDormant(p.last_activity_at, settings.dormancy_days, now),
  );

  let pushed = 0;
  const overdue = ((people ?? []) as Pick<
    Person,
    "id" | "name" | "follow_up_every_days" | "last_contact_at" | "created_at"
  >[]).filter((p) => isFollowUpOverdue(p, now));

  for (const person of overdue) {
    const days = daysSinceContact(person, now);
    const enqueued = await enqueueNotification(supabase, userId, {
      kind: "follow_up_due",
      title: "Follow-up due",
      body: `You haven't been in touch with ${person.name} for ${days} day${days === 1 ? "" : "s"}.`,
      url: `/people/${person.id}`,
      scheduledFor: now,
      payload: { routine_id: `person:${person.id}`, person_id: person.id },
      dedupeDaily: true,
    });
    if (enqueued) pushed += 1;

    const cadenceMs = (person.follow_up_every_days ?? 0) * 86_400_000;
    await supabase
      .from("people")
      .update({ next_follow_up_at: new Date(now.getTime() + cadenceMs).toISOString() })
      .eq("id", person.id);
  }

  return {
    projects_checked: projects?.length ?? 0,
    projects_dormant: dormantProjects.length,
    people_overdue: overdue.length,
    pushes_enqueued: pushed,
  };
});

export const maxDuration = 60;
