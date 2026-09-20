import { parseExcludedStatuses, parsePriorityOrder } from "./random";
import type { BugRecord } from "./types";

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function dueTime(bug: BugRecord): number {
  if (!bug.dueDate) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(bug.dueDate);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

export interface BugReport {
  review: BugRecord[];
  urgent: BugRecord[];
  openCount: number;
  finishedCount: number;
  completedCount: number;
}

export function buildBugReport(
  bugs: BugRecord[],
  reviewStatus: string,
  priorityOrderCsv?: string,
  excludedStatusesCsv?: string,
  completeStatus = "Completed"
): BugReport {
  const reviewName = normalized(reviewStatus);
  const completeName = normalized(completeStatus);
  const review = bugs
    .filter((bug) => normalized(bug.status) === reviewName)
    .sort((left, right) => dueTime(left) - dueTime(right) || left.number - right.number);

  const excluded = parseExcludedStatuses(excludedStatusesCsv);
  const priorities = parsePriorityOrder(priorityOrderCsv);
  const priorityRank = new Map(priorities.map((priority, index) => [priority, index]));
  excluded.add(reviewName);
  const open = bugs.filter((bug) => !excluded.has(normalized(bug.status)));
  const completedCount = bugs.filter((bug) => normalized(bug.status) === completeName).length;
  const urgent = open
    .filter((bug) => priorityRank.has(normalized(bug.priority)))
    .sort((left, right) =>
      (priorityRank.get(normalized(left.priority)) ?? priorities.length)
      - (priorityRank.get(normalized(right.priority)) ?? priorities.length)
      || dueTime(left) - dueTime(right)
      || left.number - right.number
    )
    .slice(0, 5);

  return {
    review,
    urgent,
    openCount: open.length,
    finishedCount: review.length + completedCount,
    completedCount
  };
}
