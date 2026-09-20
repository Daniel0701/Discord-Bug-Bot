const required = ["DISCORD_APPLICATION_ID", "DISCORD_GUILD_ID", "DISCORD_BOT_TOKEN"];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
}

const command = {
  name: "bug",
  description: "Search and manage the Notion bug tracker",
  type: 1,
  options: [
    {
      type: 1,
      name: "find",
      description: "Check whether a bug probably already exists",
      options: [
        {
          type: 3,
          name: "description",
          description: "Describe the behavior, screen, platform, and any error code",
          required: true,
          min_length: 5,
          max_length: 1000
        }
      ]
    },
    {
      type: 1,
      name: "next",
      description: "Show the highest bug number and the next suggested number"
    },
    {
      type: 1,
      name: "gamba",
      description: "Gamble on a random unfinished bug, weighted toward higher priority"
    },
    {
      type: 1,
      name: "report",
      description: "Post a public bug overview (advanced permissions, 10-second cooldown)"
    },
    {
      type: 1,
      name: "create",
      description: "Create a bug in Notion with the required fields",
      options: [
        {
          type: 3,
          name: "team",
          description: "Exact Team category from Notion",
          required: true,
          min_length: 1,
          max_length: 100
        },
        {
          type: 3,
          name: "priority",
          description: "Bug priority",
          required: true,
          choices: [
            { name: "Critical — blocks/crashes/data loss", value: "Critical" },
            { name: "High — serious gameplay impact", value: "High" },
            { name: "Medium — incorrect behavior/workaround", value: "Medium" },
            { name: "Low — visual/audio/UI/polish", value: "Low" },
            { name: "Overdue — get to work", value: "Overdue" }
          ]
        },
        {
          type: 3,
          name: "description",
          description: "What happened, expected behavior, reproduction steps, and platform",
          required: true,
          min_length: 10,
          max_length: 4000
        },
        {
          type: 3,
          name: "video",
          description: "Required video link showing the bug (Google Drive, YouTube, etc.)",
          required: true,
          min_length: 8,
          max_length: 2000
        }
      ]
    },
    {
      type: 1,
      name: "review",
      description: "Mark a bug Ready for Review",
      options: [
        {
          type: 4,
          name: "number",
          description: "The numeric part of the bug ID, for example 6",
          required: true,
          min_value: 1
        }
      ]
    },
    {
      type: 1,
      name: "complete",
      description: "Mark a bug Completed (advanced permissions required)",
      options: [
        {
          type: 4,
          name: "number",
          description: "The numeric part of the bug ID, for example 6",
          required: true,
          min_value: 1
        }
      ]
    },
    {
      type: 1,
      name: "assign",
      description: "Assign a bug to a Notion member (advanced permissions required)",
      options: [
        {
          type: 4,
          name: "number",
          description: "The numeric part of the bug ID, for example 6",
          required: true,
          min_value: 1
        },
        {
          type: 3,
          name: "assignee",
          description: "Exact display name of the member in Notion",
          required: true,
          min_length: 1,
          max_length: 100
        }
      ]
    },
    {
      type: 1,
      name: "due",
      description: "Set a bug due date (advanced permissions required)",
      options: [
        {
          type: 4,
          name: "number",
          description: "The numeric part of the bug ID, for example 6",
          required: true,
          min_value: 1
        },
        {
          type: 3,
          name: "date",
          description: "Due date in YYYY-MM-DD format",
          required: true,
          min_length: 10,
          max_length: 10
        }
      ]
    }
  ]
};

const url = `https://discord.com/api/v10/applications/${process.env.DISCORD_APPLICATION_ID}/guilds/${process.env.DISCORD_GUILD_ID}/commands`;
const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(command)
});

if (!response.ok) {
  console.error(`Command registration failed (${response.status}): ${await response.text()}`);
  process.exit(1);
}

const registered = await response.json();
console.log(`Registered /bug for guild ${process.env.DISCORD_GUILD_ID} as command ${registered.id}.`);
