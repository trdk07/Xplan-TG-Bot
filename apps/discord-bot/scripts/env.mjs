import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function loadEnv() {
  let local = {};
  try { local = parseEnv(readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw new Error("無法解析 .dev.vars，請檢查格式。"); }
  return { ...local, ...process.env };
}
export const requiredNames = [
  "DISCORD_APPLICATION_ID", "DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID",
  "DISCORD_VERIFICATION_CHANNEL_ID", "DISCORD_TRIAL_ROLE_ID", "DISCORD_MEMBER_ROLE_ID",
  "DISCORD_PARTNER_ROLE_ID",
  "NOTION_API_KEY", "NOTION_DATA_SOURCE_ID", "AUTH_SECRET",
];
export function missingNames(env) { return requiredNames.filter((name) => !env[name]?.trim()); }
