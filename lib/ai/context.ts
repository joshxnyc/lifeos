import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatInTimeZone } from "date-fns-tz";

/**
 * SPEC §7: every prompt receives a context block — today's date and timezone,
 * domains, active projects/areas per domain, known people (100 most recently
 * contacted), and active routines. Kept under ~4k tokens.
 */
export async function buildContext(
  supabase: SupabaseClient,
  userId: string,
  timezone: string,
): Promise<string> {
  const [domains, projects, people, routines] = await Promise.all([
    supabase.from("domains").select("id, name, slug").eq("user_id", userId).order("sort_order"),
    supabase
      .from("projects")
      .select("id, name, kind, description, domain_id, status")
      .eq("user_id", userId)
      .eq("status", "active"),
    supabase
      .from("people")
      .select("id, name, emails, relationship")
      .eq("user_id", userId)
      .order("last_contact_at", { ascending: false, nullsFirst: false })
      .limit(100),
    supabase.from("routines").select("id, name, schedule_days").eq("user_id", userId).eq("active", true),
  ]);

  const now = new Date();
  const lines: string[] = [
    `Today is ${formatInTimeZone(now, timezone, "EEEE, d MMMM yyyy")} (${formatInTimeZone(now, timezone, "yyyy-MM-dd")}), timezone ${timezone}.`,
    "",
    "## Domains",
    ...(domains.data ?? []).map((d) => `- ${d.name} (id: ${d.id}, slug: ${d.slug})`),
    "",
    "## Active projects and areas",
  ];

  for (const d of domains.data ?? []) {
    const inDomain = (projects.data ?? []).filter((p) => p.domain_id === d.id);
    if (!inDomain.length) continue;
    lines.push(`### ${d.name}`);
    for (const p of inDomain) {
      const desc = p.description ? ` — ${String(p.description).split("\n")[0]?.slice(0, 120)}` : "";
      lines.push(`- ${p.name} (${p.kind}, id: ${p.id})${desc}`);
    }
  }

  lines.push("", "## Known people");
  for (const p of people.data ?? []) {
    const rel = p.relationship ? `, ${p.relationship}` : "";
    const email = p.emails?.[0] ? ` <${p.emails[0]}>` : "";
    lines.push(`- ${p.name}${email}${rel} (id: ${p.id})`);
  }

  lines.push("", "## Active routines");
  for (const r of routines.data ?? []) {
    lines.push(`- ${r.name} (id: ${r.id})`);
  }

  return lines.join("\n");
}
