import { getConfig, isDiscordId } from "../src/config.ts";
import { loadEnv, missingNames } from "./env.mjs";

try {
  const env = loadEnv();
  const missing = missingNames(env);
  if (missing.length) throw new Error(`尚缺設定：\n${missing.join("\n")}`);
  getConfig(env);
  if (!isDiscordId(env.DISCORD_VERIFICATION_CHANNEL_ID)) throw new Error("DISCORD_VERIFICATION_CHANNEL_ID 格式不正確");
  console.log("設定格式檢查通過。此檢查不會連線或顯示任何密鑰；實際權限請執行 npm run discord:setup -- --check。");
} catch (error) { console.error(error instanceof SyntaxError ? "JSON 設定格式不正確" : error.message); process.exitCode = 1; }
