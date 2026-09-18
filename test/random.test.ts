import { describe, expect, it } from "vitest";
import { parseExcludedStatuses, parsePriorityOrder, pickHighestPriorityBug } from "../src/random";
import type { BugRecord } from "../src/types";

function bug(number: number, priority: string, status = "Open"): BugRecord {
  return {
    pageId: String(number),
    number,
    title: `Bug ${number}`,
    description: "",
    team: "Gameplay",
    priority,
    status,
    url: `https://notion.so/${number}`
  };
}

describe("highest-priority random selection", () => {
  it("always chooses Overdue when any unfinished Overdue bug exists", () => {
    const bugs = [
      bug(1, "Overdue"),
      ...Array.from({ length: 99 }, (_, index) => bug(index + 2, "Critical"))
    ];
    const selected = pickHighestPriorityBug(
      bugs,
      parsePriorityOrder(undefined),
      parseExcludedStatuses(undefined),
      0.99
    );
    expect(selected?.number).toBe(1);
  });

  it("falls through to the next available priority tier", () => {
    const bugs = [bug(1, "High"), bug(2, "Medium"), bug(3, "Low")];
    const selected = pickHighestPriorityBug(
      bugs,
      parsePriorityOrder(undefined),
      parseExcludedStatuses(undefined),
      0
    );
    expect(selected?.number).toBe(1);
  });

  it("chooses randomly within the highest available tier", () => {
    const bugs = [bug(1, "Critical"), bug(2, "Critical"), bug(3, "High")];
    const order = parsePriorityOrder(undefined);
    const excluded = parseExcludedStatuses(undefined);
    expect(pickHighestPriorityBug(bugs, order, excluded, 0)?.number).toBe(1);
    expect(pickHighestPriorityBug(bugs, order, excluded, 0.99)?.number).toBe(2);
  });

  it("excludes completed, review, and cancelled bugs before selecting a tier", () => {
    const bugs = [
      bug(1, "Overdue", "Completed"),
      bug(2, "Critical", "Ready for Review"),
      bug(3, "High", "Cancelled"),
      bug(4, "Medium")
    ];
    const selected = pickHighestPriorityBug(
      bugs,
      parsePriorityOrder(undefined),
      parseExcludedStatuses(undefined),
      0
    );
    expect(selected?.number).toBe(4);
  });

  it("ignores priorities outside the configured order", () => {
    const selected = pickHighestPriorityBug(
      [bug(1, "Unspecified")],
      parsePriorityOrder(undefined),
      parseExcludedStatuses(undefined),
      0
    );
    expect(selected).toBeUndefined();
  });
});
