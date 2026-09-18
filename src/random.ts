import type { BugRecord } from "./types";

const DEFAULT_PRIORITY_ORDER = ["overdue", "critical", "high", "medium", "low"];

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

export function parsePriorityOrder(csv: string | undefined): string[] {
  const priorities = (csv ?? DEFAULT_PRIORITY_ORDER.join(",")).split(",").map(normalized).filter(Boolean);
  return priorities.length ? [...new Set(priorities)] : [...DEFAULT_PRIORITY_ORDER];
}

export function parseExcludedStatuses(csv: string | undefined): Set<string> {
  const value = csv ?? "Completed,Ready for Review,Cutting Room Floor,Done,Cancelled,Canceled,Duplicate,Won't fix,Wont fix";
  return new Set(value.split(",").map(normalized).filter(Boolean));
}

export function pickHighestPriorityBug(
  bugs: BugRecord[],
  priorityOrder: string[],
  excludedStatuses: Set<string>,
  randomValue?: number
): BugRecord | undefined {
  const eligible = bugs.filter((bug) => !excludedStatuses.has(normalized(bug.status)));
  for (const priority of priorityOrder) {
    const candidates = eligible.filter((bug) => normalized(bug.priority) === normalized(priority));
    if (!candidates.length) continue;
    const generated = randomValue ?? crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
    const index = Math.floor(Math.min(Math.max(generated, 0), 0.9999999999999999) * candidates.length);
    return candidates[index];
  }
  return undefined;
}
