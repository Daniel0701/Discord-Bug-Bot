import { editOriginalResponse, escapeDiscord, hasAdvancedPermissions, optionValue, selectedSubcommand, verifyDiscordRequest } from "./discord";
import {
  createBug,
  getOptionProperty,
  getPropertyType,
  listBugs,
  listNotionUsers,
  setBugAssignee,
  setBugDueDate,
  setBugStatus
} from "./notion";
import { parseExcludedStatuses, parsePriorityOrder, pickHighestPriorityBug } from "./random";
import { searchBugs } from "./search";
import type { BugRecord, DiscordInteraction, Env, SearchResult } from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };
const EPHEMERAL = 64;

function latestNumber(bugs: BugRecord[]): number {
  return bugs.reduce((max, bug) => Math.max(max, bug.number), 0);
}

function linkFor(bug: BugRecord): string {
  return bug.url ? `[Open in Notion](${bug.url})` : "Notion link unavailable";
}

function canonicalOption(value: string, options: string[]): string | undefined {
  const normalized = value.trim().toLowerCase();
  return options.find((option) => option.trim().toLowerCase() === normalized);
}

function candidateLine(result: SearchResult): string {
  const percent = Math.round(result.score * 100);
  return `• **BUG-${result.bug.number}** — ${escapeDiscord(result.bug.title)} (${percent}% similar, ${escapeDiscord(result.bug.status)})`;
}

async function handleFind(interaction: DiscordInteraction, env: Env): Promise<string> {
  const subcommand = selectedSubcommand(interaction);
  const description = optionValue<string>(subcommand, "description")?.trim();
  if (!description) return "Please provide a bug description.";

  const bugs = await listBugs(env);
  const limit = Number.parseInt(env.SEARCH_CANDIDATE_LIMIT ?? "3", 10) || 3;
  const threshold = Number.parseFloat(env.SEARCH_MATCH_THRESHOLD ?? "0.56");
  const results = searchBugs(description, bugs, limit);
  const best = results[0];
  const latest = latestNumber(bugs);

  if (best && best.score >= threshold) {
    const reason = best.reasons.length ? `\nWhy: ${escapeDiscord(best.reasons.join(", "))}.` : "";
    return [
      `**Likely existing bug: BUG-${best.bug.number} — ${escapeDiscord(best.bug.title)}**`,
      `Status: ${escapeDiscord(best.bug.status)} · Similarity: ${Math.round(best.score * 100)}%`,
      linkFor(best.bug) + reason,
      "",
      "Please review the linked recording before logging a new bug."
    ].join("\n");
  }

  const lines = [
    "**No likely existing bug was found.**",
    latest > 0 ? `The current highest number is BUG-${latest}; the next suggested number is **BUG-${latest + 1}**.` : "Add some bugs to search for bugs."
  ];
  if (results.length) {
    lines.push("", "Closest results:", ...results.map(candidateLine));
  }
  lines.push("", "The bot may have missed bugs described with very different wording, so do check the closest result.");
  return lines.join("\n");
}

async function handleNext(env: Env): Promise<string> {
  const bugs = await listBugs(env);
  const latest = latestNumber(bugs);
  return latest > 0
    ? `The current highest number is **BUG-${latest}**. The next suggested number is **BUG-${latest + 1}**.\n\nTip: run this bug before logging a bug to know where to start!`
    : "No numbered bugs were found. The first suggested number is **BUG-1**.";
}

async function handleRandom(env: Env): Promise<string> {
  const bugs = await listBugs(env);
  const bug = pickHighestPriorityBug(
    bugs,
    parsePriorityOrder(env.RANDOM_PRIORITY_ORDER),
    parseExcludedStatuses(env.RANDOM_EXCLUDED_STATUSES)
  );
  if (!bug) return "🎉 No eligible unfinished bugs were found. Congrats, no work for you!";
  return [
    "🎲 **Your randomly selected bug:**",
    `**BUG-${bug.number} — ${escapeDiscord(bug.title)}**`,
    `Team: ${escapeDiscord(bug.team)} · Priority: ${escapeDiscord(bug.priority)} · Status: ${escapeDiscord(bug.status)}`,
    linkFor(bug)
  ].join("\n");
}

async function handleCreate(interaction: DiscordInteraction, env: Env): Promise<string> {
  const subcommand = selectedSubcommand(interaction);
  const requestedTeam = optionValue<string>(subcommand, "team")?.trim() ?? "";
  const requestedPriority = optionValue<string>(subcommand, "priority")?.trim() ?? "";
  const description = optionValue<string>(subcommand, "description")?.trim() ?? "";
  if (!requestedTeam || !requestedPriority || !description) {
    return "Team, priority, and description are all required.";
  }

  const teamName = env.NOTION_TEAM_PROPERTY ?? "Team";
  const priorityName = env.NOTION_PRIORITY_PROPERTY ?? "Priority";
  const scopeName = env.NOTION_SCOPE_PROPERTY ?? "Discipline";
  const scopeValue = env.NOTION_SCOPE_VALUE ?? "QA";
  const expectedScopeType = env.NOTION_SCOPE_TYPE ?? "multi_select";
  const [teamProperty, priorityProperty, scopeProperty] = await Promise.all([
    getOptionProperty(env, teamName),
    getOptionProperty(env, priorityName),
    getOptionProperty(env, scopeName)
  ]);
  if (!teamProperty || teamProperty.type !== "multi_select") {
    return `The Notion property **${escapeDiscord(teamName)}** must be a Multi-select property before bugs can be created.`;
  }
  if (!priorityProperty || priorityProperty.type !== "select") {
    return `The Notion property **${escapeDiscord(priorityName)}** must be a Select property before bugs can be created.`;
  }
  if (!scopeProperty || scopeProperty.type !== expectedScopeType) {
    return `Safety check failed: Notion **${escapeDiscord(scopeName)}** must be a ${escapeDiscord(expectedScopeType)} property. No bug was created.`;
  }
  if (!canonicalOption(scopeValue, scopeProperty.options)) {
    return `Safety check failed: **${escapeDiscord(scopeValue)}** is not an option in Notion **${escapeDiscord(scopeName)}**. No bug was created.`;
  }

  const team = canonicalOption(requestedTeam, teamProperty.options);
  if (!team) {
    const choices = teamProperty.options.slice(0, 25).map(escapeDiscord).join(", ") || "none configured";
    return `Unknown team **${escapeDiscord(requestedTeam)}**. Available Notion teams: ${choices}.`;
  }
  const priority = canonicalOption(requestedPriority, priorityProperty.options);
  if (!priority) {
    return `Priority **${escapeDiscord(requestedPriority)}** does not exist in Notion. Please select from the drop down and try again.`;
  }

  const bugs = await listBugs(env);
  const next = latestNumber(bugs) + 1;
  const bug = await createBug(
    env,
    { number: next, team, priority, description },
    teamProperty.type,
    priorityProperty.type,
    scopeProperty.type
  );
  return [
    `✅ **Bug #${bug.number} created**`,
    `Team: ${escapeDiscord(team)} · Priority: ${escapeDiscord(priority)}`,
    escapeDiscord(description.length > 700 ? `${description.slice(0, 697)}...` : description),
    linkFor(bug),
    "",
    "**Reminder:** Open the Notion page and add any useful details. A Google Drive video link is strongly recommended, but not required. Assignee and due date can be assigned later."
  ].join("\n");
}

async function handleStatus(
  interaction: DiscordInteraction,
  env: Env,
  statusName: string,
  advancedOnly: boolean
): Promise<string> {
  if (advancedOnly && !hasAdvancedPermissions(interaction, env)) {
    return `Advanced permissions are required to mark bugs **${escapeDiscord(statusName)}**.`;
  }
  const number = optionValue<number>(selectedSubcommand(interaction), "number");
  if (!Number.isSafeInteger(number) || (number ?? 0) < 1) return "Please provide a valid bug number.";

  const bugs = await listBugs(env);
  const matches = bugs.filter((bug) => bug.number === number);
  if (matches.length === 0) return `BUG-${number} was not found.`;
  if (matches.length > 1) return `BUG-${number} is duplicated in Notion. No update was made; resolve the duplicate numbers first.`;

  const bug = matches[0];
  if (bug.status.toLowerCase() === statusName.toLowerCase()) {
    return `BUG-${number} is already ${escapeDiscord(statusName)}. ${linkFor(bug)}`;
  }
  await setBugStatus(env, bug, statusName);
  return `**BUG-${number} — ${escapeDiscord(bug.title)}** is now **${escapeDiscord(statusName)}**.\n${linkFor(bug)}`;
}

async function exactBug(number: number, env: Env): Promise<{ bug?: BugRecord; error?: string }> {
  const bugs = await listBugs(env);
  const matches = bugs.filter((bug) => bug.number === number);
  if (matches.length === 0) return { error: `BUG-${number} was not found.` };
  if (matches.length > 1) {
    return { error: `BUG-${number} is duplicated in Notion. No update was made; resolve the duplicate numbers first.` };
  }
  return { bug: matches[0] };
}

async function handleAssign(interaction: DiscordInteraction, env: Env): Promise<string> {
  if (!hasAdvancedPermissions(interaction, env)) return "Advanced permissions are required to assign bugs.";
  const subcommand = selectedSubcommand(interaction);
  const number = optionValue<number>(subcommand, "number");
  const requestedAssignee = optionValue<string>(subcommand, "assignee")?.trim() ?? "";
  if (!Number.isSafeInteger(number) || (number ?? 0) < 1) return "Please provide a valid bug number.";
  if (!requestedAssignee) return "Provide the exact Notion display name of the assignee.";

  const propertyName = env.NOTION_ASSIGNEE_PROPERTY ?? "Assignee";
  if (await getPropertyType(env, propertyName) !== "people") {
    return `The Notion property **${escapeDiscord(propertyName)}** must be a People property before bugs can be assigned.`;
  }
  const users = await listNotionUsers(env);
  const normalized = requestedAssignee.toLowerCase();
  const matches = users.filter((user) => user.id === requestedAssignee || user.name.toLowerCase() === normalized);
  if (matches.length === 0) {
    const choices = users.slice(0, 20).map((user) => escapeDiscord(user.name)).join(", ") || "none visible to the integration";
    return `No exact Notion member named **${escapeDiscord(requestedAssignee)}** was found. Available members: ${choices}.`;
  }
  if (matches.length > 1) {
    return `More than one Notion member is named **${escapeDiscord(requestedAssignee)}**. Use that member's Notion user ID instead.`;
  }
  const result = await exactBug(number as number, env);
  if (!result.bug) return result.error ?? "Bug lookup failed.";
  await setBugAssignee(env, result.bug, matches[0].id);
  return `**BUG-${number} — ${escapeDiscord(result.bug.title)}** is now assigned to **${escapeDiscord(matches[0].name)}**.\n${linkFor(result.bug)}`;
}

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function handleDue(interaction: DiscordInteraction, env: Env): Promise<string> {
  if (!hasAdvancedPermissions(interaction, env)) return "Advanced permissions are required to set bug due dates.";
  const subcommand = selectedSubcommand(interaction);
  const number = optionValue<number>(subcommand, "number");
  const dueDate = optionValue<string>(subcommand, "date")?.trim() ?? "";
  if (!Number.isSafeInteger(number) || (number ?? 0) < 1) return "Please provide a valid bug number.";
  if (!validIsoDate(dueDate)) return "Provide a due date in YYYY-MM-DD format, for example 2026-09-30.";

  const propertyName = env.NOTION_DUE_DATE_PROPERTY ?? "Due Date";
  if (await getPropertyType(env, propertyName) !== "date") {
    return `The Notion property **${escapeDiscord(propertyName)}** must be a Date property before due dates can be set.`;
  }
  const result = await exactBug(number as number, env);
  if (!result.bug) return result.error ?? "Bug lookup failed.";
  await setBugDueDate(env, result.bug, dueDate);
  return `**BUG-${number} — ${escapeDiscord(result.bug.title)}** is now due **${escapeDiscord(dueDate)}**.\n${linkFor(result.bug)}`;
}

async function handleCommand(interaction: DiscordInteraction, env: Env): Promise<string> {
  if (interaction.data?.name !== "bug") return "Unknown command.";
  const subcommand = selectedSubcommand(interaction)?.name;
  if (subcommand === "find") return handleFind(interaction, env);
  if (subcommand === "next") return handleNext(env);
  if (subcommand === "gamba") return handleRandom(env);
  if (subcommand === "create") return handleCreate(interaction, env);
  if (subcommand === "review") return handleStatus(interaction, env, env.NOTION_REVIEW_STATUS ?? "Ready for Review", false);
  if (subcommand === "complete") return handleStatus(interaction, env, env.NOTION_COMPLETE_STATUS ?? env.NOTION_DONE_STATUS ?? "Completed", true);
  if (subcommand === "assign") return handleAssign(interaction, env);
  if (subcommand === "due") return handleDue(interaction, env);
  return "Unknown bug subcommand.";
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    if (request.method === "GET") return new Response("Discord Notion bug bot is running.");
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const rawBody = await request.text();
    if (!(await verifyDiscordRequest(request, rawBody, env.DISCORD_PUBLIC_KEY))) {
      return new Response("Invalid request signature", { status: 401 });
    }

    let interaction: DiscordInteraction;
    try {
      interaction = JSON.parse(rawBody) as DiscordInteraction;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (interaction.type === 1) {
      return new Response(JSON.stringify({ type: 1 }), { headers: JSON_HEADERS });
    }
    if (interaction.type !== 2) return new Response("Unsupported interaction", { status: 400 });

    context.waitUntil(
      handleCommand(interaction, env)
        .catch((error: unknown) => {
          console.error(error);
          return "The command failed while communicating with Notion. An administrator should check the Worker logs and integration permissions.";
        })
        .then((message) => editOriginalResponse(interaction, message))
        .catch((error: unknown) => console.error(error))
    );

    return new Response(JSON.stringify({ type: 5, data: { flags: EPHEMERAL } }), { headers: JSON_HEADERS });
  }
};
