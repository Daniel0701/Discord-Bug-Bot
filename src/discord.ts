import type { DiscordInteraction, DiscordOption, Env } from "./types";

function hexToBytes(hex: string): ArrayBuffer {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error("Invalid hex value");
  const output = new Uint8Array(hex.length / 2);
  for (let i = 0; i < output.length; i += 1) output[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return output.buffer;
}

export async function verifyDiscordRequest(
  request: Request,
  rawBody: string,
  publicKey: string
): Promise<boolean> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const payload = new TextEncoder().encode(timestamp + rawBody).buffer;
    return crypto.subtle.verify("Ed25519", key, hexToBytes(signature), payload);
  } catch {
    return false;
  }
}

export function selectedSubcommand(interaction: DiscordInteraction): DiscordOption | undefined {
  return interaction.data?.options?.find((option) => option.type === 1);
}

export function isReportCommand(interaction: DiscordInteraction): boolean {
  return interaction.data?.name === "bug" && selectedSubcommand(interaction)?.name === "report";
}

export function optionValue<T extends string | number | boolean>(
  subcommand: DiscordOption | undefined,
  name: string
): T | undefined {
  return subcommand?.options?.find((option) => option.name === name)?.value as T | undefined;
}

function idSet(csv: string | undefined): Set<string> {
  return new Set((csv ?? "").split(",").map((value) => value.trim()).filter(Boolean));
}

export function hasAdvancedPermissions(interaction: DiscordInteraction, env: Env): boolean {
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  if (userId && idSet(env.ADVANCED_PERMS_USER_IDS).has(userId)) return true;
  const allowedRoles = idSet(env.ADVANCED_PERMS_ROLE_IDS);
  return (interaction.member?.roles ?? []).some((role) => allowedRoles.has(role));
}

export async function editOriginalResponse(
  interaction: DiscordInteraction,
  content: string
): Promise<void> {
  const safeContent = content.length <= 2000 ? content : `${content.slice(0, 1997)}...`;
  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: safeContent, allowed_mentions: { parse: [] } })
    }
  );
  if (!response.ok) throw new Error(`Discord follow-up failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
}

export function escapeDiscord(text: string): string {
  return text.replace(/([\\`*_{}\[\]()<>#+\-.!|>])/g, "\\$1");
}
