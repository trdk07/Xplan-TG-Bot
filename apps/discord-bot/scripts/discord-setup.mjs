import { getConfig, isDiscordId } from "../src/config.ts";
import { loadEnv, missingNames } from "./env.mjs";

const permission = { administrator: 8n, manageRoles: 1n << 28n, view: 1n << 10n, send: 1n << 11n, history: 1n << 16n };
const invitePermissions = permission.manageRoles | permission.view | permission.send | permission.history;
export const command = { name: "verify", type: 1, description: "以交易所、UID 和 Email 驗證現有 Xplan 會員" };
export const panel = {
  content: "**Xplan 現有會員驗證**\n\n已經報名的會員，請點「驗證現有會員」，輸入報名時填寫的 Exchange ID 和 Email。完成後會依目前會籍取得試用或正式會員身分組。\n\nTG 與 Discord 共用同一份會籍及到期日。已綁定者可點「更新身分組」。\n你也可以先使用免費資源，隨時再回來驗證。",
  allowed_mentions: { parse: [] },
  components: [{ type: 1, components: [
    { type: 2, style: 1, custom_id: "xplan:verify", label: "驗證現有會員" },
    { type: 2, style: 2, custom_id: "xplan:sync", label: "更新身分組" },
  ] }],
};

async function main() {
  const mode = process.argv[2] || "--plan";
  if (!["--plan", "--check", "--apply"].includes(mode) || process.argv.length > 3) throw new Error("用法：npm run discord:setup -- [--plan|--check|--apply]");
  const env = loadEnv();
  const selectedPanel = env.MEMBERSHIP_POLICY_V2_ENABLED === "true" ? { ...panel,
    content: "**Xplan 現有會員驗證**\n\n已經報名的會員，請點「驗證現有會員」，選擇報名的交易所，再輸入 UID 和 Email。完成後依 Notion 會籍取得探索者、宇航員或飛行員身分組。\n\n一般成員完成伺服器規則確認後，每 10 分鐘自動取得探索者。付費或交易量達標者為宇航員，合作夥伴為飛行員。已綁定者可點「更新身分組」。",
  } : panel;
  if (mode === "--plan") {
    console.log(JSON.stringify({ command, panel: selectedPanel }, null, 2));
    console.log("預覽完成，未連線 Discord。");
    const missing = missingNames(env);
    if (missing.length) console.log(`尚缺設定名稱：${missing.join(", ")}`);
    if (isDiscordId(env.DISCORD_APPLICATION_ID)) {
      const params = new URLSearchParams({ client_id: env.DISCORD_APPLICATION_ID, scope: "bot applications.commands", permissions: String(invitePermissions) });
      if (isDiscordId(env.DISCORD_GUILD_ID)) { params.set("guild_id", env.DISCORD_GUILD_ID); params.set("disable_guild_select", "true"); }
      console.log(`Bot 安裝網址：https://discord.com/oauth2/authorize?${params}`);
    }
    return;
  }
  const missing = missingNames(env);
  if (missing.length) throw new Error(`尚缺設定：${missing.join(", ")}`);
  const config = getConfig(env);
  const channelId = env.DISCORD_VERIFICATION_CHANNEL_ID;
  if (!isDiscordId(channelId)) throw new Error("DISCORD_VERIFICATION_CHANNEL_ID 格式不正確");
  if (env.DISCORD_PANEL_MESSAGE_ID && !isDiscordId(env.DISCORD_PANEL_MESSAGE_ID)) throw new Error("DISCORD_PANEL_MESSAGE_ID 格式不正確");
  async function api(path, method = "GET", body) {
    const response = await fetch(`https://discord.com/api/v10${path}`, {
      method, headers: { Authorization: `Bot ${config.botToken}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Discord ${method} ${path.split("?")[0]} 失敗（HTTP ${response.status}，code ${error.code || "unknown"}）；請檢查 bot 是否已加入伺服器及具備權限。`);
    }
    return response.status === 204 ? null : response.json();
  }
  // All checks complete before registering a command or publishing the panel.
  const [application, bot, roles, channel] = await Promise.all([
    api("/oauth2/applications/@me"), api("/users/@me"),
    api(`/guilds/${config.guildId}/roles`), api(`/channels/${channelId}`),
  ]);
  if (config.membershipPolicyV2Enabled && !(application.flags & (1 << 14 | 1 << 15))) throw new Error("V2 成員枚舉需要 Server Members Intent；請先在 Developer Portal 啟用並核對應用程式權限。");
  if (application.id !== config.applicationId || !bot.bot) throw new Error("Token 與 Application ID 不一致，或不是 Bot Token");
  if (channel.guild_id !== config.guildId || channel.type !== 0) throw new Error("驗證入口必須是指定伺服器內的文字頻道");
  const self = await api(`/guilds/${config.guildId}/members/${bot.id}`);
  const botRoles = roles.filter((role) => self.roles.includes(role.id) || role.id === config.guildId);
  const base = botRoles.reduce((value, role) => value | BigInt(role.permissions), 0n);
  const admin = Boolean(base & permission.administrator);
  if (!admin && !(base & permission.manageRoles)) throw new Error("Bot 缺少管理身分組權限");
  const top = Math.max(...botRoles.map((role) => role.position));
  for (const id of new Set([config.trialRoleId, config.memberRoleId, config.nonExpiringRoleId, config.partnerRoleId])) {
    const role = roles.find((candidate) => candidate.id === id);
    if (!role || role.managed || role.position >= top) throw new Error(`會員身分組 ${id} 不存在、由整合管理，或位置不低於 Bot`);
    const staffPermissions = permission.administrator | permission.manageRoles | 32n | 16n | 4n | 2n;
    if (BigInt(role.permissions) & staffPermissions) throw new Error(`會員身分組 ${id} 含管理權限，請使用專屬的普通會員身分組`);
  }
  let channelPermissions = base;
  if (!admin) {
    const overwrites = channel.permission_overwrites || [];
    const apply = (overwrite) => { if (overwrite) channelPermissions = channelPermissions & ~BigInt(overwrite.deny) | BigInt(overwrite.allow); };
    apply(overwrites.find((o) => o.id === config.guildId));
    const roleOverwrites = overwrites.filter((o) => o.type === 0 && o.id !== config.guildId && self.roles.includes(o.id));
    const deny = roleOverwrites.reduce((v, o) => v | BigInt(o.deny), 0n);
    const allow = roleOverwrites.reduce((v, o) => v | BigInt(o.allow), 0n);
    channelPermissions = channelPermissions & ~deny | allow;
    apply(overwrites.find((o) => o.type === 1 && o.id === bot.id));
    const needed = permission.view | permission.send | permission.history;
    if ((channelPermissions & needed) !== needed) throw new Error("Bot 在驗證頻道缺少查看、傳送訊息或讀取歷史訊息權限");
  }
  let existingPanel;
  if (env.DISCORD_PANEL_MESSAGE_ID) {
    existingPanel = await api(`/channels/${channelId}/messages/${env.DISCORD_PANEL_MESSAGE_ID}`);
    if (existingPanel.author.id !== bot.id) throw new Error("指定的驗證入口訊息不是此 Bot 發送的");
  } else {
    // Reuse a recent panel after a repeated setup instead of duplicating it.
    const recent = await api(`/channels/${channelId}/messages?limit=100`);
    existingPanel = recent.find((message) => message.author?.id === bot.id && message.components?.some((row) => row.components?.some((c) => c.custom_id === "xplan:verify")));
  }
  console.log(`權限檢查通過：${application.name}，驗證頻道 #${channel.name}。`);
  if (mode === "--check") { console.log("唯讀檢查完成，未發送訊息或修改設定。"); return; }
  // POST upserts this command by name; do not bulk-overwrite other guild commands.
  await api(`/applications/${config.applicationId}/guilds/${config.guildId}/commands`, "POST", command);
  const published = existingPanel
    ? await api(`/channels/${channelId}/messages/${existingPanel.id}`, "PATCH", selectedPanel)
    : await api(`/channels/${channelId}/messages`, "POST", selectedPanel);
  console.log(`已設定 /verify 和驗證入口。請保留 DISCORD_PANEL_MESSAGE_ID=${published.id}`);
  console.log(`入口：https://discord.com/channels/${config.guildId}/${channelId}/${published.id}`);
}
main().catch((error) => { console.error(error instanceof SyntaxError ? "設定或 API JSON 格式不正確" : error.message); process.exitCode = 1; });
