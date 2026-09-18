import { describe, expect, it } from "vitest";
import { matchTaskByTitle } from "@/lib/domain/task-match";

const katsu = { id: "t-katsu", title: "Make chicken katsu" };
const memo = { id: "t-memo", title: "Send Bernhard the LP consent memo" };
const flights = { id: "t-flights", title: "Book flights to Vienna" };
const catering = { id: "t-catering", title: "Update catering order" };
const tasks = [katsu, memo, flights, catering];

describe("matchTaskByTitle", () => {
  it("matches an exact title", () => {
    expect(matchTaskByTitle("Make chicken katsu", tasks)).toBe(katsu);
    expect(matchTaskByTitle("Book flights to Vienna", tasks)).toBe(flights);
  });

  it("matches an exact title wrapped in filler words", () => {
    expect(matchTaskByTitle("the make chicken katsu task", tasks)).toBe(katsu);
  });

  it("matches a partial phrase", () => {
    expect(matchTaskByTitle("the katsu task", tasks)).toBe(katsu);
    expect(matchTaskByTitle("chicken katsu", tasks)).toBe(katsu);
    expect(matchTaskByTitle("the LP consent memo", tasks)).toBe(memo);
  });

  it("matches tokens out of order", () => {
    expect(matchTaskByTitle("the Vienna flights", tasks)).toBe(flights);
  });

  it("matches when the query contains the whole title", () => {
    expect(matchTaskByTitle("that make chicken katsu thing from yesterday", tasks)).toBe(katsu);
  });

  it("returns null when the phrase is ambiguous", () => {
    const two = [...tasks, { id: "t-katsu2", title: "Buy chicken katsu ingredients" }];
    expect(matchTaskByTitle("the katsu task", two)).toBeNull();
    expect(matchTaskByTitle("chicken katsu", two)).toBeNull();
  });

  it("prefers an exact title over a phrase match elsewhere", () => {
    const two = [...tasks, { id: "t-katsu2", title: "Buy chicken katsu ingredients" }];
    expect(matchTaskByTitle("Make chicken katsu", two)).toBe(katsu);
  });

  it("never matches on a substring of a word", () => {
    expect(matchTaskByTitle("cat", tasks)).toBeNull(); // not "catering"
    expect(matchTaskByTitle("the kats task", tasks)).toBeNull(); // not "katsu"
    expect(matchTaskByTitle("consent memos", tasks)).toBeNull(); // "memos" is not "memo"
  });

  it("ignores case and punctuation", () => {
    expect(matchTaskByTitle("KATSU!", tasks)).toBe(katsu);
    expect(matchTaskByTitle("l.p. consent memo", tasks)).toBe(memo); // punctuation-split initials drop, "consent memo" carries it
    expect(matchTaskByTitle("(the memo)", tasks)).toBe(memo);
    expect(matchTaskByTitle("MAKE CHICKEN KATSU.", tasks)).toBe(katsu);
  });

  it("ignores accents both ways", () => {
    const cafe = { id: "t-cafe", title: "Réserver le café" };
    expect(matchTaskByTitle("reserver le cafe", [...tasks, cafe])).toBe(cafe);
    expect(matchTaskByTitle("le café", [...tasks, cafe])).toBe(cafe);
  });

  it("handles empty and all-filler inputs", () => {
    expect(matchTaskByTitle("", tasks)).toBeNull();
    expect(matchTaskByTitle("   ", tasks)).toBeNull();
    expect(matchTaskByTitle("the task", tasks)).toBeNull();
    expect(matchTaskByTitle("katsu", [])).toBeNull();
  });
});
