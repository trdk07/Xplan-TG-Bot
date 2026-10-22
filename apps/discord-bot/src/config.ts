import type { Config } from "./types";
export type Variables = Record<string, unknown>;
const idPattern = /^\d{15,22}$/;
export function isDiscordId(value: unknown): value is string { return typeof value === "string" && idPattern.test(value); }
export function pageKey(id: string): string { return id.replaceAll("-", "").toLowerCase(); }
function required(env: Variables, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing configuration: ${name}`);
  return value.trim();
}
export function getConfig(env: Variables): Config {
  const id = (name: string) => {
    const value = required(env, name);
    if (!isDiscordId(value)) throw new Error(`Invalid configuration: ${name}`);
    return value;
  };
  const applicationId = id("DISCORD_APPLICATION_ID");
  const guildId = id("DISCORD_GUILD_ID");
  const trialRoleId = id("DISCORD_TRIAL_ROLE_ID");
  const memberRoleId = id("DISCORD_MEMBER_ROLE_ID");
  const partnerRoleId = id("DISCORD_PARTNER_ROLE_ID");
  const nonExpiringRoleId = env.DISCORD_NON_EXPIRING_ROLE_ID ? id("DISCORD_NON_EXPIRING_ROLE_ID") : memberRoleId;
  if (trialRoleId === memberRoleId || trialRoleId === nonExpiringRoleId
    || [trialRoleId, memberRoleId, nonExpiringRoleId].includes(partnerRoleId)
    || [trialRoleId, memberRoleId, nonExpiringRoleId, partnerRoleId].includes(guildId)) {
    throw new Error("Trial, member and partner roles must be distinct and cannot be @everyone");
  }
  const publicKey = required(env, "DISCORD_PUBLIC_KEY");
  if (!/^[a-fA-F0-9]{64}$/.test(publicKey)) throw new Error("Invalid configuration: DISCORD_PUBLIC_KEY");
  const authSecret = required(env, "AUTH_SECRET");
  if (authSecret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  const notionDataSourceId = required(env, "NOTION_DATA_SOURCE_ID");
  if (!/^[a-fA-F0-9]{32}$/.test(pageKey(notionDataSourceId))) throw new Error("Invalid Notion data source ID");
  const raw: unknown = JSON.parse(String(env.MEMBER_TIER_OVERRIDES || "{}"));
  if (!raw || Array.isArray(raw) || typeof raw !== "object") throw new Error("Invalid MEMBER_TIER_OVERRIDES");
  const tierOverrides: Config["tierOverrides"] = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[a-fA-F0-9]{32}$/.test(pageKey(key)) || (value !== "trial" && value !== "paid")) throw new Error("Invalid MEMBER_TIER_OVERRIDES entry");
    tierOverrides[pageKey(key)] = value;
  }
  const incompleteMemberPolicy = env.INCOMPLETE_MEMBER_POLICY || "trial";
  if (incompleteMemberPolicy !== "trial" && incompleteMemberPolicy !== "review") throw new Error("Invalid INCOMPLETE_MEMBER_POLICY");
  return {
    incompleteMemberPolicy, applicationId, publicKey, guildId, trialRoleId, memberRoleId, partnerRoleId, nonExpiringRoleId, authSecret,
    botToken: required(env, "DISCORD_BOT_TOKEN"),
    notionApiKey: required(env, "NOTION_API_KEY"), notionDataSourceId,
    notionEmailProperty: String(env.NOTION_EMAIL_PROPERTY || "Email"),
    notionDiscordIdProperty: String(env.NOTION_DISCORD_ID_PROPERTY || "Discord_id"),
    tierOverrides,
  };
}
