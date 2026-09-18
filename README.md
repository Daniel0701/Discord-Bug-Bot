# Discord → Notion Bug Bot

A Discord bot for finding, creating, and managing QA bugs in a Notion task database. It runs as a Cloudflare Worker and replies privately to Discord slash commands.

## Commands

| Usage | What it does | Access |
|---|---|---|
| `/bug find <description>` | Searches for a similar existing bug | Everyone |
| `/bug next` | Shows the highest and next bug number | Everyone |
| `/bug gamba` | Picks from the highest available unfinished priority | Everyone |
| `/bug create <team> <priority> <description>` | Creates the next numbered bug | Everyone |
| `/bug review <number>` | Marks a bug Ready for Review | Everyone |
| `/bug complete <number>` | Marks a bug Completed | Advanced permissions |
| `/bug assign <number> <assignee>` | Assigns a bug to a Notion member | Advanced permissions |
| `/bug due <number> <YYYY-MM-DD>` | Sets a bug's due date | Advanced permissions |

Discord prompts for these fields after a subcommand is selected. Enter only the numeric part of a bug ID in `number` (for example, `12` for `Bug #12`). `assignee` must exactly match the person's Notion display name, and `date` must use `YYYY-MM-DD`.

`/bug gamba` checks priorities in this order: Overdue, Critical, High, Medium, then Low. It randomly picks within the first tier that has unfinished bugs, so any Overdue bug always takes precedence over Critical and lower priorities.

## Notion Setup

The data source must contain these properties:

| Property | Type |
|---|---|
| `Task` | Title |
| `Description` | Rich text |
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
