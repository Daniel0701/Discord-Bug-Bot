import { describe, expect, it } from "vitest";
import { hasAdvancedPermissions } from "../src/discord";
import type { DiscordInteraction, Env } from "../src/types";

const env: Env = {
  DISCORD_APPLICATION_ID: "app",
  DISCORD_PUBLIC_KEY: "key",
  NOTION_TOKEN: "token",
  NOTION_DATA_SOURCE_ID: "task-sheet",
  ADVANCED_PERMS_ROLE_IDS: "advanced-role,other-advanced-role",
  ADVANCED_PERMS_USER_IDS: "advanced-user"
};

function interaction(userId: string, roles: string[]): DiscordInteraction {
  return {
    id: "interaction",
    application_id: "app",
    type: 2,
    token: "interaction-token",
    member: { user: { id: userId }, roles }
  };
}

describe("advanced permission authorization", () => {
  it("allows a configured advanced-permissions role", () => {
    expect(hasAdvancedPermissions(interaction("member", ["advanced-role"]), env)).toBe(true);
  });

  it("allows a configured individual user", () => {
    expect(hasAdvancedPermissions(interaction("advanced-user", []), env)).toBe(true);
  });

  it("rejects users outside the advanced-permissions allowlist", () => {
    expect(hasAdvancedPermissions(interaction("member", ["unrelated-role"]), env)).toBe(false);
  });
});
