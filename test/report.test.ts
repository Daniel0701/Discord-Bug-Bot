import { describe, expect, it } from "vitest";
import { buildBugReport } from "../src/report";
import type { BugRecord } from "../src/types";

function bug(
  number: number,
  priority: string,
  status = "Not Started",
  dueDate?: string
): BugRecord {
  return {
    pageId: String(number),
    number,
    title: `Bug ${number}`,
    description: "",
    team: "Engineering",
    priority,
    status,
    url: `https://notion.so/${number}`,
    dueDate
  };
}

describe("bug report ranking", () => {
  it("separates review work from the urgent unfinished list", () => {
    const result = buildBugReport([
      bug(1, "Critical", "Ready for Review"),
      bug(2, "High"),
      bug(3, "Overdue", "Completed")
    ], "Ready for Review");

    expect(result.review.map((item) => item.number)).toEqual([1]);
    expect(result.urgent.map((item) => item.number)).toEqual([2]);
    expect(result.openCount).toBe(1);
    expect(result.finishedCount).toBe(2);
    expect(result.completedCount).toBe(1);
  });

  it("never repeats review bugs in urgent work when exclusions are customized", () => {
    const result = buildBugReport([
      bug(1, "Critical", "Ready for Review"),
      bug(2, "High")
    ], "Ready for Review", undefined, "Completed");

    expect(result.review.map((item) => item.number)).toEqual([1]);
    expect(result.urgent.map((item) => item.number)).toEqual([2]);
  });

  it("ranks by priority, then due date, and returns only five", () => {
    const result = buildBugReport([
      bug(1, "High", "Not Started", "2026-09-20"),
      bug(2, "Critical", "Not Started", "2026-10-20"),
      bug(3, "Critical", "Not Started", "2026-09-25"),
      bug(4, "Medium"),
      bug(5, "Low"),
      bug(6, "Overdue"),
      bug(7, "Critical")
    ], "Ready for Review");

    expect(result.urgent.map((item) => item.number)).toEqual([6, 3, 2, 7, 1]);
  });

  it("orders review bugs by due date", () => {
    const result = buildBugReport([
      bug(1, "Low", "Ready for Review"),
      bug(2, "High", "ready for review", "2026-09-20")
    ], "Ready for Review");

    expect(result.review.map((item) => item.number)).toEqual([2, 1]);
  });

  it("uses the configured completed status for counts", () => {
    const result = buildBugReport([
      bug(1, "High", "Done"),
      bug(2, "Medium", "Ready for Review"),
      bug(3, "Low")
    ], "Ready for Review", undefined, undefined, "Done");

    expect(result.openCount).toBe(1);
    expect(result.completedCount).toBe(1);
    expect(result.finishedCount).toBe(2);
  });
});
