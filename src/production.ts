import { escapeDiscord, listChannelAuthorIdsSince, sendChannelMessage } from "./discord";
import type { Env } from "./types";

const NOTION_VERSION = "2026-03-11";

type Milestone = {
  title: string;
  dueDate: string;
  status: string;
  url: string;
  discordUserIds: string[];
  ownerNames: string[];
  unmappedOwnerNames: string[];
};

function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function propertyText(property: Record<string, unknown> | undefined): string {
  if (!property) return "";
  for (const key of ["title", "rich_text"]) {
    const value = property[key];
    if (Array.isArray(value)) {
      return value.flatMap((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).plain_text === "string"
        ? [(item as Record<string, unknown>).plain_text as string]
        : []).join("");
    }
  }
  for (const key of ["status", "select"]) {
    const value = property[key];
    if (value && typeof value === "object" && typeof (value as Record<string, unknown>).name === "string") {
      return (value as Record<string, unknown>).name as string;
    }
  }
  if (Array.isArray(property.multi_select)) {
    return property.multi_select.flatMap((option) => {
      if (!option || typeof option !== "object") return [];
      const name = (option as Record<string, unknown>).name;
      return typeof name === "string" ? [name] : [];
    }).join(",");
  }
  if (typeof property.url === "string") return property.url;
  return "";
}

function propertyDate(property: Record<string, unknown> | undefined): string {
  const date = property?.date;
  if (!date || typeof date !== "object") return "";
  const start = (date as Record<string, unknown>).start;
  return typeof start === "string" ? start.slice(0, 10) : "";
}

function people(property: Record<string, unknown> | undefined): Array<{ id: string; name: string }> {
  if (!Array.isArray(property?.people)) return [];
  return property.people.flatMap((person) => {
    if (!person || typeof person !== "object") return [];
    const value = person as Record<string, unknown>;
    return typeof value.id === "string"
      ? [{ id: value.id, name: typeof value.name === "string" ? value.name : "" }]
      : [];
  });
}

function userMap(env: Env): Record<string, string> {
  if (!env.AGP_DISCORD_USER_MAP) return {};
  try {
    const parsed = JSON.parse(env.AGP_DISCORD_USER_MAP) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    throw new Error("AGP_DISCORD_USER_MAP must be a JSON object");
  }
}

function mappedDiscordId(mapping: Record<string, string>, notionId: string, notionName: string): string | undefined {
  const exact = mapping[notionId] ?? mapping[notionName];
  if (exact) return exact;
  const normalizedName = notionName.trim().toLowerCase();
  const firstName = normalizedName.split(/\s+/)[0];
  for (const [key, value] of Object.entries(mapping)) {
    const normalizedKey = key.trim().toLowerCase();
    if (normalizedKey === normalizedName || normalizedKey === firstName) return value;
  }
  return undefined;
}

function zonedParts(date: Date, timeZone: string): { year: number; month: number; day: number; weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday: weekdays[value("weekday")] ?? 0,
    hour: Number(value("hour")),
    minute: Number(value("minute"))
  };
}

function localMidnightInstant(year: number, month: number, day: number, timeZone: string): Date {
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12));
  const zoneName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset"
  }).formatToParts(noonUtc).find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(zoneName);
  if (!match) throw new Error(`Unable to determine UTC offset for ${timeZone}`);
  const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1);
  return new Date(Date.UTC(year, month - 1, day) - minutes * 60_000);
}

function localHourInstant(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const midnight = localMidnightInstant(year, month, day, timeZone);
  return new Date(midnight.getTime() + hour * 60 * 60 * 1000);
}

export function weekRange(date: Date, timeZone = "America/Los_Angeles"): { start: string; end: string; startInstant: Date } {
  const local = zonedParts(date, timeZone);
  const mondayOffset = (local.weekday + 6) % 7;
  const anchor = new Date(Date.UTC(local.year, local.month - 1, local.day));
  anchor.setUTCDate(anchor.getUTCDate() - mondayOffset);
  const end = new Date(anchor);
  end.setUTCDate(end.getUTCDate() + 6);
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  return {
    start: iso(anchor),
    end: iso(end),
    startInstant: localMidnightInstant(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, anchor.getUTCDate(), timeZone)
  };
}

export function weeklyUpdateWindowStart(date: Date, timeZone = "America/Los_Angeles", hour = 9): Date {
  const range = weekRange(date, timeZone);
  const [year, month, day] = range.start.split("-").map(Number);
  return localHourInstant(year, month, day, hour, timeZone);
}

export function upcomingThursday(date: Date, timeZone = "America/Los_Angeles"): string {
  const local = zonedParts(date, timeZone);
  const anchor = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const daysUntilThursday = (4 - local.weekday + 7) % 7;
  anchor.setUTCDate(anchor.getUTCDate() + daysUntilThursday);
  return anchor.toISOString().slice(0, 10);
}

async function notionRequest<T>(env: Env, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) throw new Error(`Notion milestone query failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return response.json<T>();
}

async function milestoneDataSourceId(env: Env): Promise<string> {
  if (env.AGP_NOTION_DATA_SOURCE_ID) return env.AGP_NOTION_DATA_SOURCE_ID;
  if (!env.AGP_NOTION_DATABASE_ID) {
    throw new Error("AGP_NOTION_DATA_SOURCE_ID or AGP_NOTION_DATABASE_ID is not configured");
  }
  const database = await notionRequest<{ data_sources?: Array<{ id?: unknown; name?: unknown }> }>(
    env,
    `/databases/${env.AGP_NOTION_DATABASE_ID}`,
    { method: "GET" }
  );
  const sources = (database.data_sources ?? []).filter((source): source is { id: string; name?: unknown } =>
    typeof source.id === "string");
  if (sources.length !== 1) {
    throw new Error(`The AGP Notion database contains ${sources.length} data sources; configure AGP_NOTION_DATA_SOURCE_ID explicitly`);
  }
  return sources[0].id;
}

export async function listWeeklyMilestones(env: Env, now = new Date()): Promise<Milestone[]> {
  const dataSourceId = await milestoneDataSourceId(env);
  const dueProperty = env.AGP_DUE_DATE_PROPERTY ?? "Due Date";
  const titleProperty = env.AGP_TITLE_PROPERTY ?? "Name";
  const statusProperty = env.AGP_STATUS_PROPERTY ?? "Status";
  const disciplineProperty = env.AGP_DISCIPLINE_PROPERTY ?? "Discipline";
  const validProperty = env.AGP_VALID_PROPERTY ?? "Valid";
  const ownerProperty = env.AGP_OWNER_PROPERTY ?? "Owner";
  const discordProperty = env.AGP_OWNER_DISCORD_PROPERTY ?? "Discord User ID";
  const complete = new Set(csv(env.AGP_COMPLETE_STATUSES ?? "Completed,Done,Cancelled,Canceled").map((item) => item.toLowerCase()));
  const excludedDisciplines = new Set(csv(env.AGP_EXCLUDED_DISCIPLINES ?? "Faculty Reviews").map((item) => item.toLowerCase()));
  const mapping = userMap(env);
  const dueDate = upcomingThursday(now, env.PROD_TIME_ZONE);
  const milestones: Milestone[] = [];
  let cursor: string | undefined;
  do {
    const body: Record<string, unknown> = {
      page_size: 100,
      filter: {
        and: [
          { property: dueProperty, date: { on_or_after: dueDate } },
          { property: dueProperty, date: { on_or_before: dueDate } },
          { property: validProperty, checkbox: { equals: true } }
        ]
      },
      sorts: [{ property: dueProperty, direction: "ascending" }]
    };
    if (cursor) body.start_cursor = cursor;
    const page = await notionRequest<{
      results: Array<{ url?: string; properties?: Record<string, Record<string, unknown>> }>;
      has_more: boolean;
      next_cursor: string | null;
    }>(env, `/data_sources/${dataSourceId}/query`, { method: "POST", body: JSON.stringify(body) });
    for (const item of page.results) {
      const properties = item.properties ?? {};
      const status = propertyText(properties[statusProperty]) || "Unknown";
      if (complete.has(status.toLowerCase())) continue;
      const title = propertyText(properties[titleProperty]) || "Untitled milestone";
      const disciplines = csv(propertyText(properties[disciplineProperty])).map((item) => item.toLowerCase());
      if (disciplines.some((discipline) => excludedDisciplines.has(discipline))) continue;
      const directIds = csv(propertyText(properties[discordProperty]));
      const milestoneOwners = people(properties[ownerProperty]);
      const mappedOwners = milestoneOwners.map((person) => ({
        name: person.name,
        discordId: mappedDiscordId(mapping, person.id, person.name)
      }));
      const mappedIds = mappedOwners.flatMap((owner) => owner.discordId ? [owner.discordId] : []);
      milestones.push({
        title,
        dueDate: propertyDate(properties[dueProperty]),
        status,
        url: item.url ?? env.AGP_NOTION_PAGE_URL ?? "",
        discordUserIds: [...new Set([...directIds, ...mappedIds])],
        ownerNames: milestoneOwners.map((person) => person.name).filter(Boolean),
        unmappedOwnerNames: mappedOwners.flatMap((owner) => !owner.discordId && owner.name ? [owner.name] : [])
      });
    }
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (cursor);
  return milestones;
}

function targetChannel(env: Env, kind: "update" | "milestone"): string {
  const value = kind === "update"
    ? env.WEEKLY_UPDATE_CHANNEL_ID ?? env.PROD_CHANNEL_ID
    : env.MILESTONE_CHANNEL_ID ?? env.PROD_CHANNEL_ID;
  if (!value) {
    throw new Error(`${kind === "update" ? "WEEKLY_UPDATE_CHANNEL_ID" : "MILESTONE_CHANNEL_ID"} or PROD_CHANNEL_ID is not configured`);
  }
  return value;
}

export function weeklyUpdateInitialReminder(env: Env): {
  content: string;
  allowedUserIds: string[];
  allowedRoleIds: string[];
} {
  const required = csv(env.WEEKLY_UPDATE_USER_IDS);
  if (!required.length) throw new Error("WEEKLY_UPDATE_USER_IDS is not configured");
  const allowedRoleIds = env.WEEKLY_UPDATE_ROLE_ID ? [env.WEEKLY_UPDATE_ROLE_ID] : [];
  const allowedUserIds = allowedRoleIds.length ? [] : required;
  const mention = allowedRoleIds.map((id) => `<@&${id}>`).join(" ") || required.map((id) => `<@${id}>`).join(" ");
  const link = env.WEEKLY_UPDATE_PAGE_URL ? `\n${env.WEEKLY_UPDATE_PAGE_URL}` : "";
  return {
    content: `**${mention} status updates r due eod today!! please include:**\n1) what u did and what u r doing\n2) should any get a blue and why\n3) should any get a yellow/red and why\n4) is there any specific person or discipline u want to meet with during thursday lab${link}`,
    allowedUserIds,
    allowedRoleIds
  };
}

export async function postWeeklyUpdateReminder(env: Env, followup: boolean, now = new Date()): Promise<string> {
  const channelId = targetChannel(env, "update");
  const required = csv(env.WEEKLY_UPDATE_USER_IDS);
  if (!required.length) throw new Error("WEEKLY_UPDATE_USER_IDS is not configured");
  const timeZone = env.PROD_TIME_ZONE ?? "America/Los_Angeles";
  const initialHour = configuredNumber(env.PROD_UPDATE_HOUR, 9);
  const authors = followup
    ? await listChannelAuthorIdsSince(env, channelId, weeklyUpdateWindowStart(now, timeZone, initialHour))
    : new Set<string>();
  const missing = followup ? required.filter((id) => !authors.has(id)) : required;
  if (followup && !missing.length) return "Everyone has posted a weekly update; no follow-up was sent.";
  if (!followup) {
    const reminder = weeklyUpdateInitialReminder(env);
    await sendChannelMessage(env, channelId, reminder.content, reminder.allowedUserIds, reminder.allowedRoleIds);
  } else {
    const mention = missing.map((id) => `<@${id}>`).join(" ");
    const link = env.WEEKLY_UPDATE_PAGE_URL ? `\n${env.WEEKLY_UPDATE_PAGE_URL}` : "";
    await sendChannelMessage(
      env,
      channelId,
      `${mention}\nPlease send your status update soon!${link}`,
      missing
    );
  }
  return `Posted the ${followup ? "follow-up" : "initial"} weekly-update reminder${followup ? ` for ${missing.length} member(s)` : ""}.`;
}

export async function postMilestoneReminder(env: Env, now = new Date()): Promise<string> {
  const channelId = targetChannel(env, "milestone");
  const milestones = (await listWeeklyMilestones(env, now)).sort((left, right) =>
    Number(left.ownerNames.length === 0) - Number(right.ownerNames.length === 0));
  const allUsers = [...new Set(milestones.flatMap((milestone) => milestone.discordUserIds))];
  const folderUrl = env.AGP_DELIVERABLES_FOLDER_URL ?? "https://drive.google.com/drive/folders/16nHkMP0h33OCKCE6OAIbMsj3lU1RAuWd";
  const header = `Here are the faculty deliverables due this week. Please make sure all deliverables are uploaded to the [folder](${folderUrl}) by Wednesday night:`;
  const lines = milestones.length
    ? milestones.map((milestone) => {
      const ownerLabels = [
        ...milestone.discordUserIds.map((id) => `<@${id}>`),
        ...milestone.unmappedOwnerNames.map(escapeDiscord)
      ];
      const owners = ownerLabels.join(" ") || "Unassigned";
      const title = milestone.title.length > 180 ? `${milestone.title.slice(0, 177)}...` : milestone.title;
      return `${owners} - ${escapeDiscord(title)}`;
    })
    : ["No incomplete faculty deliverables are due this week."];
  const messages: string[] = [];
  let current = header;
  for (const line of lines) {
    if (`${current}\n${line}`.length > 2000 && current !== header) {
      messages.push(current);
      current = `${header} _(continued)_\n${line}`;
    } else {
      current += `\n${line}`;
    }
  }
  messages.push(current);
  for (const message of messages) await sendChannelMessage(env, channelId, message, allUsers);
  return `Posted ${milestones.length} milestone${milestones.length === 1 ? "" : "s"} due this week.`;
}

function configuredNumber(value: string | undefined, fallback: number): number {
  const number = Number.parseInt(value ?? "", 10);
  return Number.isInteger(number) ? number : fallback;
}

export async function runProductionSchedule(env: Env, now = new Date()): Promise<string[]> {
  const local = zonedParts(now, env.PROD_TIME_ZONE ?? "America/Los_Angeles");
  const results: string[] = [];
  if (local.weekday === configuredNumber(env.PROD_UPDATE_WEEKDAY, 1)
    && local.hour === configuredNumber(env.PROD_UPDATE_HOUR, 9)
    && local.minute === configuredNumber(env.PROD_UPDATE_MINUTE, 0)) {
    results.push(await postWeeklyUpdateReminder(env, false, now));
  }
  if (local.weekday === configuredNumber(env.PROD_UPDATE_FOLLOWUP_WEEKDAY, 1)
    && local.hour === configuredNumber(env.PROD_UPDATE_FOLLOWUP_HOUR, 20)
    && local.minute === configuredNumber(env.PROD_UPDATE_FOLLOWUP_MINUTE, 0)) {
    results.push(await postWeeklyUpdateReminder(env, true, now));
  }
  if (env.PROD_MILESTONE_AUTOMATIC === "true"
    && local.weekday === configuredNumber(env.PROD_MILESTONE_WEEKDAY, 1)
    && local.hour === configuredNumber(env.PROD_MILESTONE_HOUR, 9)
    && local.minute === configuredNumber(env.PROD_MILESTONE_MINUTE, 5)) {
    results.push(await postMilestoneReminder(env, now));
  }
  return results;
}
