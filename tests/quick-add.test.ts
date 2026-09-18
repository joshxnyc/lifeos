import { describe, expect, it } from "vitest";
import { parseQuickAdd, type QuickAddContext } from "@/lib/domain/quick-add";

// 2026-09-15 is a Tuesday.
const ctx: QuickAddContext = {
  today: "2026-09-15",
  domains: [
    { id: "d-personal", slug: "personal", name: "Personal" },
    { id: "d-almedia", slug: "almedia", name: "Almedia" },
    { id: "d-tarifa", slug: "tarifa", name: "Tarifa" },
    { id: "d-misc", slug: "misc", name: "Misc" },
  ],
  projects: [
    { id: "p-juicy", name: "Juicy Energy", domain_id: "d-tarifa" },
    { id: "p-lp", name: "LP consents", domain_id: "d-tarifa" },
    { id: "p-apartment", name: "Apartment", domain_id: "d-personal" },
  ],
  people: [
    { id: "per-bernhard", name: "Bernhard Niesner" },
    { id: "per-ben", name: "Ben Carter" },
  ],
};

describe("parseQuickAdd", () => {
  it("returns the plain input as the title when nothing is recognised", () => {
    const r = parseQuickAdd("Write the investment memo", ctx);
    expect(r.title).toBe("Write the investment memo");
    expect(r.tokens).toEqual([]);
    expect(r.domain_id).toBeUndefined();
  });

  it("sets the domain from #slug", () => {
    const r = parseQuickAdd("Call the broker #personal", ctx);
    expect(r.title).toBe("Call the broker");
    expect(r.domain_id).toBe("d-personal");
    expect(r.tokens).toEqual([{ raw: "#personal", kind: "domain" }]);
  });

  it("matches a domain by name prefix, case-insensitively", () => {
    expect(parseQuickAdd("Ping #Tar", ctx).domain_id).toBe("d-tarifa");
    expect(parseQuickAdd("Ping #ALM", ctx).domain_id).toBe("d-almedia");
  });

  it("sets domain and project from #domain/projectprefix", () => {
    const r = parseQuickAdd("Draft the memo #tarifa/juicy", ctx);
    expect(r.title).toBe("Draft the memo");
    expect(r.domain_id).toBe("d-tarifa");
    expect(r.project_id).toBe("p-juicy");
    expect(r.tokens).toEqual([{ raw: "#tarifa/juicy", kind: "project" }]);
  });

  it("matches a project on a later word of its name", () => {
    expect(parseQuickAdd("Chase #tarifa/energy", ctx).project_id).toBe("p-juicy");
    expect(parseQuickAdd("Chase #tarifa/consents", ctx).project_id).toBe("p-lp");
  });

  it("keeps the domain when the project part matches nothing", () => {
    const r = parseQuickAdd("Something #tarifa/zzz", ctx);
    expect(r.domain_id).toBe("d-tarifa");
    expect(r.project_id).toBeUndefined();
    expect(r.tokens).toEqual([{ raw: "#tarifa/zzz", kind: "domain" }]);
  });

  it("leaves an unknown #token in the title", () => {
    const r = parseQuickAdd("Post about #growth", ctx);
    expect(r.title).toBe("Post about #growth");
    expect(r.domain_id).toBeUndefined();
    expect(r.tokens).toEqual([]);
  });

  it("links a person by name prefix", () => {
    const r = parseQuickAdd("Send the deck @bernhard", ctx);
    expect(r.title).toBe("Send the deck");
    expect(r.person_id).toBe("per-bernhard");
    expect(r.tokens).toEqual([{ raw: "@bernhard", kind: "person" }]);
  });

  it("prefers an exact person match over a shorter prefix", () => {
    expect(parseQuickAdd("Ping @ben", ctx).person_id).toBe("per-ben");
  });

  it("matches a person on their surname", () => {
    expect(parseQuickAdd("Ping @niesner", ctx).person_id).toBe("per-bernhard");
  });

  it("leaves an unknown @token in the title", () => {
    const r = parseQuickAdd("Reply to @unknownperson", ctx);
    expect(r.title).toBe("Reply to @unknownperson");
    expect(r.person_id).toBeUndefined();
  });

  it("parses every priority token", () => {
    expect(parseQuickAdd("Thing !high", ctx).priority).toBe(3);
    expect(parseQuickAdd("Thing !med", ctx).priority).toBe(2);
    expect(parseQuickAdd("Thing !medium", ctx).priority).toBe(2);
    expect(parseQuickAdd("Thing !low", ctx).priority).toBe(1);
    expect(parseQuickAdd("Thing !none", ctx).priority).toBe(0);
    expect(parseQuickAdd("Thing !HIGH", ctx).priority).toBe(3);
  });

  it("leaves an unknown !token in the title", () => {
    const r = parseQuickAdd("Fix the bug !!!", ctx);
    expect(r.title).toBe("Fix the bug !!!");
    expect(r.priority).toBeUndefined();
  });

  it("reads a trailing weekday as the due date", () => {
    const r = parseQuickAdd("Send the wire fri", ctx);
    expect(r.title).toBe("Send the wire");
    expect(r.due_date).toBe("2026-09-18");
    expect(r.due_time).toBeUndefined();
    expect(r.tokens).toEqual([{ raw: "fri", kind: "due" }]);
  });

  it("reads tomorrow, next week and an explicit date", () => {
    expect(parseQuickAdd("Thing tomorrow", ctx).due_date).toBe("2026-09-16");
    expect(parseQuickAdd("Thing next week", ctx).due_date).toBe("2026-09-22");
    expect(parseQuickAdd("Renew passport sep 30", ctx).due_date).toBe("2026-09-30");
    expect(parseQuickAdd("Renew passport sep 30", ctx).title).toBe("Renew passport");
  });

  it("reads a bare time as today plus a due time", () => {
    const r = parseQuickAdd("Standup 3pm", ctx);
    expect(r.title).toBe("Standup");
    expect(r.due_date).toBe("2026-09-15");
    expect(r.due_time).toBe("15:00");
  });

  it("reads a date and time together", () => {
    const r = parseQuickAdd("Call the lawyer tomorrow 3:30pm", ctx);
    expect(r.title).toBe("Call the lawyer");
    expect(r.due_date).toBe("2026-09-16");
    expect(r.due_time).toBe("15:30");
  });

  it("does not treat a trailing number as a date", () => {
    const r = parseQuickAdd("Pay invoice 30", ctx);
    expect(r.title).toBe("Pay invoice 30");
    expect(r.due_date).toBeUndefined();
  });

  it("never consumes the whole title as a date", () => {
    const r = parseQuickAdd("tomorrow", ctx);
    expect(r.title).toBe("tomorrow");
    expect(r.due_date).toBeUndefined();
  });

  it("does not read a date out of the middle of the title", () => {
    const r = parseQuickAdd("Call fri about the memo", ctx);
    expect(r.title).toBe("Call fri about the memo");
    expect(r.due_date).toBeUndefined();
  });

  it("does not read an article as a date", () => {
    const r = parseQuickAdd("Plan the week", ctx);
    expect(r.title).toBe("Plan the week");
    expect(r.due_date).toBeUndefined();
  });

  it("reports the whole matched phrase as the due token", () => {
    expect(parseQuickAdd("Ship it next week", ctx).tokens).toEqual([{ raw: "next week", kind: "due" }]);
  });

  it("sets the scheduled date from ~token", () => {
    const r = parseQuickAdd("Deep work on the memo ~sat", ctx);
    expect(r.title).toBe("Deep work on the memo");
    expect(r.scheduled_date).toBe("2026-09-19");
    expect(r.due_date).toBeUndefined();
    expect(r.tokens).toEqual([{ raw: "~sat", kind: "scheduled" }]);
  });

  it("accepts a multi-word scheduled token", () => {
    const r = parseQuickAdd("Plan the week ~next monday", ctx);
    expect(r.scheduled_date).toBe("2026-09-21");
    expect(r.title).toBe("Plan the week");
  });

  it("leaves an unparseable ~token in the title", () => {
    const r = parseQuickAdd("Check ~approx numbers", ctx);
    expect(r.title).toBe("Check ~approx numbers");
    expect(r.scheduled_date).toBeUndefined();
  });

  it("parses every token type in one line", () => {
    const r = parseQuickAdd("Draft the LP consent memo #tarifa/juicy @bernhard !high ~thu fri 9am", ctx);
    expect(r.title).toBe("Draft the LP consent memo");
    expect(r.domain_id).toBe("d-tarifa");
    expect(r.project_id).toBe("p-juicy");
    expect(r.person_id).toBe("per-bernhard");
    expect(r.priority).toBe(3);
    expect(r.scheduled_date).toBe("2026-09-17");
    expect(r.due_date).toBe("2026-09-18");
    expect(r.due_time).toBe("09:00");
    expect(r.tokens.map((t) => t.kind).sort()).toEqual(["due", "person", "priority", "project", "scheduled"].sort());
  });

  it("keeps unrecognised tokens alongside recognised ones", () => {
    const r = parseQuickAdd("Ship #nope @nobody !urgent #personal tomorrow", ctx);
    expect(r.title).toBe("Ship #nope @nobody !urgent");
    expect(r.domain_id).toBe("d-personal");
    expect(r.due_date).toBe("2026-09-16");
  });

  it("handles extra whitespace and an empty input", () => {
    expect(parseQuickAdd("   Buy   milk   ", ctx).title).toBe("Buy milk");
    const empty = parseQuickAdd("", ctx);
    expect(empty.title).toBe("");
    expect(empty.tokens).toEqual([]);
  });
});
