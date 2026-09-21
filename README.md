# Discord → Notion Bug Bot

A Discord bot for finding, creating, and managing QA bugs in a Notion task database. It runs as a Cloudflare Worker and replies privately to Discord slash commands. It also doubles as a production bot as well, able to automatically send reminders.

## Commands

| Usage | What it does | Access |
|---|---|---|
| `/bug find <description>` | Searches for a similar existing bug | Everyone |
| `/bug next` | Shows the highest and next bug number | Everyone |
| `/bug gamba` | Picks from the highest available unfinished priority | Everyone |
| `/bug report` | Publicly posts bugs awaiting review and the five most urgent open bugs | Advanced permissions |
| `/bug create <team> <priority> <description> <video>` | Creates the next numbered bug with a required video link | Everyone |
| `/bug review <number>` | Marks a bug Ready for Review | Everyone |
| `/bug complete <number>` | Marks a bug Completed | Advanced permissions |
| `/bug assign <number> <assignee>` | Assigns a bug to a Notion member | Advanced permissions |
| `/bug due <number> <YYYY-MM-DD>` | Sets a bug's due date | Advanced permissions |
| `/prod update` | Posts the weekly status-update reminder | Advanced permissions |
| `/prod milestone` | Posts incomplete AGP 26–27 milestones due this week | Advanced permissions |

Discord prompts for these fields after a subcommand is selected. Enter only the numeric part of a bug ID in `number` (for example, `12` for `Bug #12`). `assignee` must exactly match the person's Notion display name, and `date` must use `YYYY-MM-DD`.

`/bug gamba` checks priorities in this order: Overdue, Critical, High, Medium, then Low. It randomly picks within the first tier that has unfinished bugs, so any Overdue bug always takes precedence over Critical and lower priorities.

`/bug report` is the only command with a channel-visible response. It requires advanced permissions and has a 10-second cooldown per user; permission and cooldown errors remain private. The report shows counts for unfinished, finished, completed, and ready-for-review bugs. Finished is the combined completed and ready-for-review count. It then lists up to five bugs in `Ready for Review` and ranks the five most urgent unfinished bugs by priority, earliest due date, and bug number. Review and completed/cancelled statuses are excluded from the urgent-work list.

## Notion Setup

The data source must contain these properties:

| Property | Type |
|---|---|
| `Task` | Title |
| `Description` | Rich text |
| `URL` | URL (required video recording) |
| `Discipline` | Multi-select with a `QA` option |
| `Team` | Multi-select |
| `Priority` | Select |
| `Status` | Status |
| `Assignee` | People |
| `Due Date` | Date |

The bot only queries records where `Discipline` contains `QA`, and every new bug is created with `Discipline = QA`. Status must include `Ready for Review` and `Completed`.

## Setup

Requires Node.js 20+.

```powershell
npm install
npm test
npm run typecheck
npx wrangler login
npm run deploy
```

Add the required Cloudflare secrets with `npx wrangler secret put`:

```text
DISCORD_APPLICATION_ID
DISCORD_PUBLIC_KEY
NOTION_TOKEN
NOTION_DATA_SOURCE_ID
ADVANCED_PERMS_ROLE_IDS
ADVANCED_PERMS_USER_IDS (optional)
```

Set the deployed Worker URL as the Discord **Interactions Endpoint URL**. Install the application with the `applications.commands` scope, then register `/bug` in a test server:

```powershell
$env:DISCORD_APPLICATION_ID="your-application-id"
$env:DISCORD_GUILD_ID="your-server-id"
$env:DISCORD_BOT_TOKEN="your-bot-token"
npm run register
Remove-Item Env:DISCORD_APPLICATION_ID, Env:DISCORD_GUILD_ID, Env:DISCORD_BOT_TOKEN
```

Never commit or share Discord or Notion tokens. Local secrets belong in `.dev.vars`, which is excluded from Git.

## Updating

After changing Worker code:

```powershell
npm test
npm run typecheck
npm run deploy
```

Run `npm run register` again only when slash-command names or options change.

## Production reminders

The Worker checks its production schedule hourly and evaluates it in `PROD_TIME_ZONE` (Pacific time by default). Every Monday it posts the initial weekly status-update reminder at 9:00 AM. At 8:00 PM it checks the dedicated update channel and mentions only configured leads who have not posted since the 9:00 AM reminder. A dedicated update channel is recommended because receipt means that the lead posted at least one non-bot message there during that window.

The initial reminder can also be sent manually with `/prod update`. The milestone reminder runs once on Monday at 9:05 AM Pacific and lists incomplete deliverables due on the upcoming Thursday whose `Valid` checkbox is checked, excluding rows whose `Discipline` is `Faculty Reviews`. Assigned deliverables appear first and unassigned deliverables last. It can also be sent manually with `/prod milestone` and has no follow-up reminder. Manual commands require the same advanced-permissions allowlist as privileged bug commands.

Add these Worker secrets:

```text
DISCORD_BOT_TOKEN
AGP_DISCORD_USER_MAP (optional when the database has a Discord User ID property)
```

Configure `WEEKLY_UPDATE_CHANNEL_ID`, `MILESTONE_CHANNEL_ID`, `WEEKLY_UPDATE_USER_IDS`, and either `AGP_NOTION_DATABASE_ID` or `AGP_NOTION_DATA_SOURCE_ID`. `PROD_CHANNEL_ID` remains a fallback when a job-specific channel is omitted. When only the visible database ID is configured, the Worker retrieves its sole queryable data source automatically. The milestone data source defaults to `Name`, `Due Date`, `Status`, `Owner`, and `Discord User ID` properties; their names can be overridden with the corresponding `AGP_*_PROPERTY` variables. Owners can be mapped to Discord IDs either through a comma-separated `Discord User ID` property on each milestone or with a JSON object in `AGP_DISCORD_USER_MAP`, keyed by Notion user ID, exact display name, or first name.

The Discord bot needs View Channel, Send Messages, and Read Message History permissions in the configured channels. Cron triggers execute in UTC, so the Worker runs hourly and applies the configured IANA timezone itself to remain correct across daylight-saving changes.
