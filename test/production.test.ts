import { afterEach, describe, expect, it, vi } from "vitest";
import { listWeeklyMilestones, postMilestoneReminder, postWeeklyUpdateReminder, runProductionSchedule, upcomingThursday, weeklyUpdateWindowStart, weekRange } from "../src/production";
import type { Env } from "../src/types";

afterEach(() => vi.unstubAllGlobals());

const env: Env = {
  DISCORD_APPLICATION_ID: "app",
  DISCORD_PUBLIC_KEY: "key",
  DISCORD_BOT_TOKEN: "bot-token",
  NOTION_TOKEN: "notion-token",
  NOTION_DATA_SOURCE_ID: "bugs",
  WEEKLY_UPDATE_CHANNEL_ID: "updates",
  WEEKLY_UPDATE_USER_IDS: "lead-1,lead-2",
  WEEKLY_UPDATE_ROLE_ID: "leads-role",
  PROD_TIME_ZONE: "America/Los_Angeles"
};

describe("production reminder week", () => {
  it("uses Monday through Sunday in Pacific daylight time", () => {
    const range = weekRange(new Date("2026-09-20T23:00:00Z"), "America/Los_Angeles");
    expect(range.start).toBe("2026-09-14");
    expect(range.end).toBe("2026-09-20");
    expect(range.startInstant.toISOString()).toBe("2026-09-14T07:00:00.000Z");
  });

  it("uses the correct offset after daylight-saving time", () => {
    const range = weekRange(new Date("2026-12-09T18:00:00Z"), "America/Los_Angeles");
    expect(range.start).toBe("2026-12-07");
    expect(range.end).toBe("2026-12-13");
    expect(range.startInstant.toISOString()).toBe("2026-12-07T08:00:00.000Z");
  });

  it("starts reply tracking at Monday 9 AM Pacific", () => {
    expect(weeklyUpdateWindowStart(
      new Date("2026-09-21T19:00:00Z"),
      "America/Los_Angeles",
      9
    ).toISOString()).toBe("2026-09-21T16:00:00.000Z");
  });

  it("posts the requested initial reminder and allows only the leads role mention", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: "message-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await postWeeklyUpdateReminder(env, false, new Date("2026-09-21T16:00:00Z"));

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      content: "**<@&leads-role> status updates r due eod today!! please include:**\n1) what u did and what u r doing\n2) should any get a blue and why\n3) should any get a yellow/red and why\n4) is there any specific person or discipline u want to meet with during thursday lab",
      allowed_mentions: { parse: [], users: [], roles: ["leads-role"], replied_user: false }
    });
  });

  it("mentions only leads who have not posted by the follow-up", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init?.method) {
        return new Response(JSON.stringify([{ id: "message-2", author: { id: "lead-1", bot: false } }]), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "message-3" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await postWeeklyUpdateReminder(env, true, new Date("2026-09-22T03:00:00Z"));

    const historyUrl = String(fetchMock.mock.calls[0][0]);
    expect(historyUrl).toContain("channels/updates/messages?limit=100&after=");
    const sendInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(sendInit.body))).toEqual({
      content: "<@lead-2>\nPlease send your status update soon!",
      allowed_mentions: { parse: [], users: ["lead-2"], roles: [], replied_user: false }
    });
  });

  it("selects the coming Thursday from Sunday or Monday", () => {
    expect(upcomingThursday(new Date("2026-09-20T19:00:00Z"), "America/Los_Angeles")).toBe("2026-09-24");
    expect(upcomingThursday(new Date("2026-09-21T19:00:00Z"), "America/Los_Angeles")).toBe("2026-09-24");
  });
});

describe("AGP milestone database", () => {
  it("resolves the data source and reads the configured AGP properties", async () => {
    const milestoneEnv: Env = {
      ...env,
      AGP_NOTION_DATABASE_ID: "database-id",
      AGP_TITLE_PROPERTY: "Milestone",
      AGP_DUE_DATE_PROPERTY: "Milestone Due Date",
      AGP_OWNER_PROPERTY: "Assignee",
      AGP_DISCORD_USER_MAP: JSON.stringify({ Ana: "lead-1" })
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/databases/database-id")) {
        return new Response(JSON.stringify({ data_sources: [{ id: "milestone-source", name: "Milestones" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        results: [{
          url: "https://notion.so/milestone",
          properties: {
            Milestone: { title: [{ plain_text: "Everybody Test" }] },
            Status: { status: { name: "Not Started" } },
            "Milestone Due Date": { date: { start: "2026-09-24" } },
            Assignee: { people: [{ id: "notion-ana", name: "Ana Hunter" }] }
          }
        }],
        has_more: false,
        next_cursor: null
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listWeeklyMilestones(milestoneEnv, new Date("2026-09-23T18:00:00Z"))).resolves.toEqual([{
      title: "Everybody Test",
      dueDate: "2026-09-24",
      status: "Not Started",
      url: "https://notion.so/milestone",
      discordUserIds: ["lead-1"],
      ownerNames: ["Ana Hunter"],
      unmappedOwnerNames: []
    }]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/data_sources/milestone-source/query");
    const queryInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(String(queryInit.body)).filter).toEqual({
      and: [
        { property: "Milestone Due Date", date: { on_or_after: "2026-09-24" } },
        { property: "Milestone Due Date", date: { on_or_before: "2026-09-24" } },
        { property: "Valid", checkbox: { equals: true } }
      ]
    });
  });

  it("runs only the milestone reminder Monday at 9:05 AM Pacific", async () => {
    const scheduleEnv: Env = {
      ...env,
      PROD_CHANNEL_ID: "milestones",
      MILESTONE_CHANNEL_ID: "faculty-deliverables",
      AGP_NOTION_DATA_SOURCE_ID: "milestone-source",
      PROD_MILESTONE_AUTOMATIC: "true",
      PROD_MILESTONE_WEEKDAY: "1",
      PROD_MILESTONE_HOUR: "9",
      PROD_MILESTONE_MINUTE: "5"
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.notion.com")) {
        return new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "milestone-message" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(runProductionSchedule(scheduleEnv, new Date("2026-09-21T16:05:00Z")))
      .resolves.toEqual(["Posted 0 milestones due this week."]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("formats the faculty deliverables message from Notion data", async () => {
    const milestoneEnv: Env = {
      ...env,
      PROD_CHANNEL_ID: "milestones",
      MILESTONE_CHANNEL_ID: "faculty-deliverables",
      AGP_NOTION_DATA_SOURCE_ID: "milestone-source",
      AGP_TITLE_PROPERTY: "Milestone",
      AGP_DUE_DATE_PROPERTY: "Milestone Due Date",
      AGP_OWNER_PROPERTY: "Assignee",
      AGP_DISCORD_USER_MAP: JSON.stringify({ Ana: "lead-1" }),
      AGP_DELIVERABLES_FOLDER_URL: "https://drive.google.com/folder"
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (String(input).includes("api.notion.com")) {
        return new Response(JSON.stringify({
          results: [
            {
              properties: {
                Milestone: { title: [{ plain_text: "Joe Marris - Microsoft (TBC)" }] },
                Status: { status: { name: "Not Started" } },
                "Milestone Due Date": { date: { start: "2026-09-24" } },
                Discipline: { multi_select: [{ name: "Production" }] },
                Assignee: { people: [] }
              }
            },
            {
              properties: {
                Milestone: { title: [{ plain_text: "Everybody Test - Group A" }] },
                Status: { status: { name: "Not Started" } },
                "Milestone Due Date": { date: { start: "2026-09-24" } },
                Discipline: { multi_select: [{ name: "Usability" }] },
                Assignee: { people: [{ id: "notion-ana", name: "Ana Hunter" }] }
              }
            },
            {
              properties: {
                Milestone: { title: [{ plain_text: "Faculty Review - Teams 1-5" }] },
                Status: { status: { name: "Not Started" } },
                "Milestone Due Date": { date: { start: "2026-09-24" } },
                Discipline: { multi_select: [{ name: "Faculty Reviews" }] },
                Assignee: { people: [] }
              }
            }
          ],
          has_more: false,
          next_cursor: null
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "discord-message" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await postMilestoneReminder(milestoneEnv, new Date("2026-09-23T18:00:00Z"));

    const sendInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(String(fetchMock.mock.calls[1][0])).toContain("channels/faculty-deliverables/messages");
    expect(JSON.parse(String(sendInit.body))).toEqual({
      content: "Here are the faculty deliverables due this week. Please make sure all deliverables are uploaded to the [folder](https://drive.google.com/folder) by Wednesday night:\n<@lead-1> - Everybody Test \\- Group A\nUnassigned - Joe Marris \\- Microsoft \\(TBC\\)",
      allowed_mentions: { parse: [], users: ["lead-1"], roles: [], replied_user: false }
    });
  });
});
