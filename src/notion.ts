import type { BugRecord, CreateBugInput, Env, NotionOptionProperty, NotionUser } from "./types";

const NOTION_VERSION = "2026-03-11";

type NotionProperty = Record<string, unknown> & { type?: string };
type NotionPage = {
  id: string;
  url?: string;
  properties?: Record<string, NotionProperty>;
};

function headers(env: Env): HeadersInit {
  return {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION
  };
}

async function notionRequest<T>(env: Env, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: { ...headers(env), ...(init.headers ?? {}) }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Notion request failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return response.json<T>();
}

function richText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const value = item as Record<string, unknown>;
      return typeof value.plain_text === "string" ? value.plain_text : "";
    })
    .join("");
}

function propertyText(property: NotionProperty | undefined): string {
  if (!property) return "";
  if (Array.isArray(property.title)) return richText(property.title);
  if (Array.isArray(property.rich_text)) return richText(property.rich_text);
  if (typeof property.url === "string") return property.url;
  if (typeof property.number === "number") return String(property.number);
  if (property.status && typeof property.status === "object") {
    const name = (property.status as Record<string, unknown>).name;
    return typeof name === "string" ? name : "";
  }
  if (property.select && typeof property.select === "object") {
    const name = (property.select as Record<string, unknown>).name;
    return typeof name === "string" ? name : "";
  }
  if (Array.isArray(property.multi_select)) {
    return property.multi_select
      .flatMap((option) => {
        if (!option || typeof option !== "object") return [];
        const name = (option as Record<string, unknown>).name;
        return typeof name === "string" ? [name] : [];
      })
      .join(", ");
  }
  if (property.formula && typeof property.formula === "object") {
    const formula = property.formula as Record<string, unknown>;
    for (const key of ["string", "number", "boolean"]) {
      if (formula[key] !== null && formula[key] !== undefined) return String(formula[key]);
    }
  }
  return "";
}

function propertyDate(property: NotionProperty | undefined): string {
  if (!property?.date || typeof property.date !== "object") return "";
  const start = (property.date as Record<string, unknown>).start;
  return typeof start === "string" ? start : "";
}

export function propertyNumber(property: NotionProperty | undefined): number | null {
  if (!property) return null;
  if (typeof property.number === "number") return property.number;
  if (property.formula && typeof property.formula === "object") {
    const number = (property.formula as Record<string, unknown>).number;
    return typeof number === "number" ? number : null;
  }
  const text = propertyText(property).trim();
  if (!text) return null;
  const parsed = Number(text);
  if (Number.isFinite(parsed)) return parsed;
  const match = text.match(/\bbug\s*(?:#|-)?\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function toBug(page: NotionPage, env: Env): BugRecord | null {
  const properties = page.properties ?? {};
  const numberName = env.NOTION_BUG_NUMBER_PROPERTY ?? env.NOTION_TASK_PROPERTY ?? "Task";
  const titleName = env.NOTION_TITLE_PROPERTY ?? env.NOTION_TASK_PROPERTY ?? "Task";
  const descriptionName = env.NOTION_DESCRIPTION_PROPERTY ?? "Description";
  const teamName = env.NOTION_TEAM_PROPERTY ?? "Team";
  const priorityName = env.NOTION_PRIORITY_PROPERTY ?? "Priority";
  const statusName = env.NOTION_STATUS_PROPERTY ?? "Status";
  const videoUrlName = env.NOTION_VIDEO_URL_PROPERTY ?? "URL";
  const dueDateName = env.NOTION_DUE_DATE_PROPERTY ?? "Due Date";
  const number = propertyNumber(properties[numberName]);
  if (number === null || !Number.isSafeInteger(number) || number < 1) return null;
  const description = propertyText(properties[descriptionName]);
  const taskTitle = propertyText(properties[titleName]) || `Bug #${number}`;
  const title = /^bug\s*(?:#|-)?\s*\d+$/i.test(taskTitle.trim()) && description
    ? description
    : taskTitle;
  const statusProperty = properties[statusName];
  const status = typeof statusProperty?.checkbox === "boolean"
    ? (statusProperty.checkbox ? (env.NOTION_COMPLETE_STATUS ?? env.NOTION_DONE_STATUS ?? "Completed") : "Not completed")
    : (propertyText(statusProperty) || "Unknown");
  return {
    pageId: page.id,
    number,
    title,
    description,
    team: propertyText(properties[teamName]) || "Unspecified",
    priority: propertyText(properties[priorityName]) || "Unspecified",
    status,
    url: page.url ?? "",
    videoUrl: propertyText(properties[videoUrlName]),
    dueDate: propertyDate(properties[dueDateName])
  };
}

function richTextValue(content: string): Array<{ type: "text"; text: { content: string } }> {
  const chunks = content.match(/[\s\S]{1,2000}/g) ?? [];
  return chunks.map((chunk) => ({ type: "text", text: { content: chunk } }));
}

function optionNames(property: NotionProperty): string[] {
  const schema = property[property.type ?? ""];
  if (!schema || typeof schema !== "object") return [];
  const options = (schema as Record<string, unknown>).options;
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) => {
    if (!option || typeof option !== "object") return [];
    const name = (option as Record<string, unknown>).name;
    return typeof name === "string" ? [name] : [];
  });
}

export async function getOptionProperty(env: Env, propertyName: string): Promise<NotionOptionProperty | null> {
  const source = await notionRequest<{ properties?: Record<string, NotionProperty> }>(
    env,
    `/data_sources/${env.NOTION_DATA_SOURCE_ID}`,
    { method: "GET" }
  );
  const property = source.properties?.[propertyName];
  if (!property || !["select", "multi_select", "status"].includes(property.type ?? "")) return null;
  return {
    type: property.type as NotionOptionProperty["type"],
    options: optionNames(property)
  };
}

export async function getPropertyType(env: Env, propertyName: string): Promise<string | null> {
  const source = await notionRequest<{ properties?: Record<string, NotionProperty> }>(
    env,
    `/data_sources/${env.NOTION_DATA_SOURCE_ID}`,
    { method: "GET" }
  );
  return source.properties?.[propertyName]?.type ?? null;
}

export async function listNotionUsers(env: Env): Promise<NotionUser[]> {
  const users: NotionUser[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const page = await notionRequest<{
      results: Array<{ id?: unknown; name?: unknown; type?: unknown }>;
      has_more: boolean;
      next_cursor: string | null;
    }>(env, `/users?${query.toString()}`, { method: "GET" });
    for (const user of page.results) {
      if (user.type === "person" && typeof user.id === "string" && typeof user.name === "string" && user.name.trim()) {
        users.push({ id: user.id, name: user.name.trim() });
      }
    }
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (cursor);
  return users;
}

function optionValue(type: NotionOptionProperty["type"], name: string): Record<string, unknown> {
  return type === "multi_select"
    ? { multi_select: [{ name }] }
    : { [type]: { name } };
}

export async function createBug(
  env: Env,
  input: CreateBugInput,
  teamType: NotionOptionProperty["type"],
  priorityType: NotionOptionProperty["type"],
  scopeType: NotionOptionProperty["type"]
): Promise<BugRecord> {
  const taskName = env.NOTION_TASK_PROPERTY ?? env.NOTION_TITLE_PROPERTY ?? "Task";
  const teamName = env.NOTION_TEAM_PROPERTY ?? "Team";
  const priorityName = env.NOTION_PRIORITY_PROPERTY ?? "Priority";
  const descriptionName = env.NOTION_DESCRIPTION_PROPERTY ?? "Description";
  const videoUrlName = env.NOTION_VIDEO_URL_PROPERTY ?? "URL";
  const scopeName = env.NOTION_SCOPE_PROPERTY ?? "Discipline";
  const scopeValue = env.NOTION_SCOPE_VALUE ?? "QA";
  const taskTitle = `Bug #${input.number}`;
  const page = await notionRequest<NotionPage>(env, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: env.NOTION_DATA_SOURCE_ID },
      properties: {
        [taskName]: { title: richTextValue(taskTitle) },
        [teamName]: optionValue(teamType, input.team),
        [priorityName]: optionValue(priorityType, input.priority),
        [scopeName]: optionValue(scopeType, scopeValue),
        [descriptionName]: { rich_text: richTextValue(input.description) },
        [videoUrlName]: { url: input.videoUrl }
      }
    })
  });
  return {
    pageId: page.id,
    number: input.number,
    title: input.description,
    description: input.description,
    team: input.team,
    priority: input.priority,
    status: "New",
    url: page.url ?? "",
    videoUrl: input.videoUrl
  };
}

export async function listBugs(env: Env): Promise<BugRecord[]> {
  const bugs: BugRecord[] = [];
  let cursor: string | undefined;
  do {
    const scopeName = env.NOTION_SCOPE_PROPERTY ?? "Discipline";
    const scopeValue = env.NOTION_SCOPE_VALUE ?? "QA";
    const scopeType = env.NOTION_SCOPE_TYPE ?? "multi_select";
    const body: Record<string, unknown> = {
      page_size: 100,
      filter: {
        property: scopeName,
        [scopeType]: scopeType === "multi_select" ? { contains: scopeValue } : { equals: scopeValue }
      }
    };
    if (cursor) body.start_cursor = cursor;
    const page = await notionRequest<{
      results: NotionPage[];
      has_more: boolean;
      next_cursor: string | null;
    }>(env, `/data_sources/${env.NOTION_DATA_SOURCE_ID}/query`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    for (const item of page.results) {
      const bug = toBug(item, env);
      if (bug) bugs.push(bug);
    }
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (cursor);
  return bugs;
}

export async function setBugStatus(env: Env, bug: BugRecord, statusName: string): Promise<void> {
  const propertyName = env.NOTION_STATUS_PROPERTY ?? "Status";
  const statusType = env.NOTION_STATUS_TYPE ?? "status";
  const value = statusType === "checkbox"
    ? { checkbox: true }
    : { [statusType]: { name: statusName } };

  await notionRequest(env, `/pages/${bug.pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { [propertyName]: value } })
  });
}

export async function setBugAssignee(env: Env, bug: BugRecord, notionUserId: string): Promise<void> {
  const propertyName = env.NOTION_ASSIGNEE_PROPERTY ?? "Assignee";
  await notionRequest(env, `/pages/${bug.pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { [propertyName]: { people: [{ id: notionUserId }] } } })
  });
}

export async function setBugDueDate(env: Env, bug: BugRecord, dueDate: string): Promise<void> {
  const propertyName = env.NOTION_DUE_DATE_PROPERTY ?? "Due Date";
  await notionRequest(env, `/pages/${bug.pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { [propertyName]: { date: { start: dueDate } } } })
  });
}
