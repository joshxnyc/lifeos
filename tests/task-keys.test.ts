import { describe, expect, it } from "vitest";
import { moveFocus } from "@/components/tasks/use-task-keys";

// Roving-focus movement for j/k on task lists (components/tasks/use-task-keys.ts).

describe("moveFocus", () => {
  it("returns -1 for an empty list", () => {
    expect(moveFocus(-1, 1, 0)).toBe(-1);
    expect(moveFocus(2, -1, 0)).toBe(-1);
  });

  it("enters the list at the near end when nothing is focused", () => {
    expect(moveFocus(-1, 1, 5)).toBe(0); // j lands on the first row
    expect(moveFocus(-1, -1, 5)).toBe(4); // k lands on the last row
  });

  it("moves by one within the list", () => {
    expect(moveFocus(0, 1, 5)).toBe(1);
    expect(moveFocus(3, -1, 5)).toBe(2);
  });

  it("clamps at the ends instead of wrapping", () => {
    expect(moveFocus(4, 1, 5)).toBe(4);
    expect(moveFocus(0, -1, 5)).toBe(0);
  });

  it("recovers when the focus index has fallen off a shrunken list", () => {
    expect(moveFocus(7, 1, 3)).toBe(0);
    expect(moveFocus(7, -1, 3)).toBe(2);
  });
});
