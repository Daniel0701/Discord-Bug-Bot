import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBug,
  listBugs,
  listNotionUsers,
  propertyNumber,
  setBugAssignee,
  setBugDueDate
} from "../src/notion";
import type { BugRecord, Env } from "../src/types";

const env: Env = {
  DISCORD_APPLICATION_ID: "app",
  DISCORD_PUBLIC_KEY: "key",
  NOTION_TOKEN: "token",
  NOTION_DATA_SOURCE_ID: "task-sheet"
};

afterEach(() => vi.unstubAllGlobals());

const bug: BugRecord = {
  pageId: "page-1",
  number: 10,
  title: "Example bug",
  description: "",
  team: "Engineering",
  priority: "High",
  status: "Open",
  url: "https://notion.so/page-1"
};

describe("Notion task-number parsing", () => {
  it("reads a number from the Task title format", () => {
    expect(propertyNumber({ title: [{ plain_text: "Bug #42" }] })).toBe(42);
  });

  it("continues to support a Number property", () => {
    expect(propertyNumber({ number: 7 })).toBe(7);
  });
});

describe("lead assignment fields", () => {
  it("lists only human Notion members", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { id: "person-1", type: "person", name: "Alex Lead" },
        { id: "bot-1", type: "bot", name: "Automation" }
      ],
      has_more: false,
      next_cursor: null
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listNotionUsers(env)).resolves.toEqual([{ id: "person-1", name: "Alex Lead" }]);
  });

  it("updates the configured People property", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await setBugAssignee(env, bug, "person-1");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      properties: { Assignee: { people: [{ id: "person-1" }] } }
    });
  });

  it("updates the configured Date property", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await setBugDueDate(env, bug, "2026-09-30");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      properties: { "Due Date": { date: { start: "2026-09-30" } } }
    });
  });
});

describe("QA Masterlist boundary", () => {
  it("filters every bug-list query to Discipline containing QA", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      results: [],
      has_more: false,
      next_cursor: null
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await listBugs(env);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      filter: { property: "Discipline", multi_select: { contains: "QA" } }
    });
  });

  it("assigns Discipline QA to every newly created bug", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      id: "page-1",
      url: "https://notion.so/page-1"
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await createBug(
      env,
      {
        number: 10,
        team: "Engineering",
        priority: "High",
        description: "Test bug",
        videoUrl: "https://drive.google.com/video"
      },
      "multi_select",
      "select",
      "multi_select"
    );

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      parent: { data_source_id: "task-sheet" },
      properties: {
        Discipline: { multi_select: [{ name: "QA" }] },
        URL: { url: "https://drive.google.com/video" }
      }
    });
  });

  it("reads video URLs and due dates for reports", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [{
        id: "page-1",
        url: "https://notion.so/page-1",
        properties: {
          Task: { title: [{ plain_text: "Bug #10" }] },
          Description: { rich_text: [{ plain_text: "Report bug" }] },
          URL: { url: "https://drive.google.com/video" },
          "Due Date": { date: { start: "2026-09-30" } }
        }
      }],
      has_more: false,
      next_cursor: null
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listBugs(env)).resolves.toMatchObject([{
      number: 10,
      videoUrl: "https://drive.google.com/video",
      dueDate: "2026-09-30"
    }]);
  });
});
