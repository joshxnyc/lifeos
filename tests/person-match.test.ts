import { describe, expect, it } from "vitest";
import { matchPersonInText } from "@/lib/domain/person-match";

const lucas = { id: "p-lucas", name: "Lucas Fernandez" };
const maria = { id: "p-maria", name: "Maria Chen" };
const bernhard = { id: "p-bernhard", name: "Bernhard Niesner" };
const people = [lucas, maria, bernhard];

describe("matchPersonInText", () => {
  it("matches a full name", () => {
    expect(matchPersonInText("Dinner with Lucas Fernandez next week", people)).toBe("p-lucas");
  });

  it("matches a unique first name", () => {
    expect(matchPersonInText("Call Lucas about the deck", people)).toBe("p-lucas");
  });

  it("returns null for an ambiguous first name", () => {
    const twoLucases = [...people, { id: "p-lucas2", name: "Lucas Marek" }];
    expect(matchPersonInText("Call Lucas about the deck", twoLucases)).toBeNull();
  });

  it("still matches the full name when the first name is shared", () => {
    const twoLucases = [...people, { id: "p-lucas2", name: "Lucas Marek" }];
    expect(matchPersonInText("Call Lucas Marek about the deck", twoLucases)).toBe("p-lucas2");
  });

  it("does not match a substring", () => {
    expect(matchPersonInText("Ping Lucastro about the invoice", people)).toBeNull();
    expect(matchPersonInText("The blucas account is down", people)).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(matchPersonInText("email LUCAS today", people)).toBe("p-lucas");
    expect(matchPersonInText("catch up with maria chen", people)).toBe("p-maria");
  });

  it("matches across punctuation boundaries", () => {
    expect(matchPersonInText("Coffee with Lucas.", people)).toBe("p-lucas");
    expect(matchPersonInText("Lucas, then the gym", people)).toBe("p-lucas");
    expect(matchPersonInText("(ask Bernhard)", people)).toBe("p-bernhard");
  });

  it("returns null when two different people are named", () => {
    expect(matchPersonInText("Intro Lucas Fernandez to Maria Chen", people)).toBeNull();
  });

  it("ignores accents both ways", () => {
    const jose = { id: "p-jose", name: "José García" };
    expect(matchPersonInText("lunch with Jose", [...people, jose])).toBe("p-jose");
    expect(matchPersonInText("lunch with José García", [...people, jose])).toBe("p-jose");
  });

  it("matches a single-word person name as a first name", () => {
    const mono = { id: "p-mono", name: "Cher" };
    expect(matchPersonInText("Tickets for Cher", [...people, mono])).toBe("p-mono");
  });

  it("never matches on a bare initial", () => {
    const initial = { id: "p-init", name: "J Smith" };
    expect(matchPersonInText("j is for jam", [...people, initial])).toBeNull();
  });

  it("handles empty inputs", () => {
    expect(matchPersonInText("", people)).toBeNull();
    expect(matchPersonInText("Call Lucas", [])).toBeNull();
  });
});
