import { describe, expect, it } from "vitest";
import { normalizeText, searchBugs } from "../src/search";
import type { BugRecord } from "../src/types";

const bugs: BugRecord[] = [
  {
    pageId: "one",
    number: 6,
    title: "Checkout spinner never finishes after payment",
    description: "On Android, checkout hangs after tapping Pay. Error PAY-42 is visible.",
    team: "Gameplay",
    priority: "High",
    status: "Open",
    url: "https://notion.so/one"
  },
  {
    pageId: "two",
    number: 7,
    title: "Profile image is blurry",
    description: "Uploaded avatars look pixelated on the settings screen.",
    team: "Art",
    priority: "Low",
    status: "Done",
    url: "https://notion.so/two"
  }
];

describe("deterministic search", () => {
  it("canonicalizes common equivalent language", () => {
    expect(normalizeText("Checkout is stuck loading")).toContain("freeze");
  });

  it("matches differently worded but overlapping descriptions", () => {
    const [result] = searchBugs("Android payment freezes with PAY-42 and keeps loading", bugs);
    expect(result.bug.number).toBe(6);
    expect(result.score).toBeGreaterThan(0.56);
  });

  it("does not overmatch an unrelated bug", () => {
    const [result] = searchBugs("Notification email contains the wrong timezone", bugs);
    expect(result.score).toBeLessThan(0.56);
  });
});
