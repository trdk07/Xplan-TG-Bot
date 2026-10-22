import { getConfig, isDiscordId } from "./config";
import { verifyDiscordSignature } from "./crypto";
import { safeError } from "./engine";
import { ids, modal } from "./messages";
import type { Interaction } from "./types";
export type HttpEnv = Record<string, unknown> & { MEMBER_GATE: {
  idFromName(name: string): unknown;
  get(id: unknown): { processInteraction(interaction: Interaction): Promise<void> };
} };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const ephemeral = (content: string) => json({ type: 4, data: { flags: 64, content, allowed_mentions: { parse: [] } } });
async function boundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > 65_536) { await reader.cancel(); return null; }
    text += decoder.decode(next.value, { stream: true });
  }
  return text + decoder.decode();
}
export const httpHandler = {
  async fetch(request: Request, env: HttpEnv, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/healthz") return json({ ok: true, service: "xplan-discord-verification", membershipStore: "notion" });
    if (path !== "/interactions") return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const signature = request.headers.get("X-Signature-Ed25519") || "";
    const timestamp = request.headers.get("X-Signature-Timestamp") || "";
    if (!/^[a-f0-9]{128}$/i.test(signature)) return json({ error: "invalid_signature" }, 401);
    const body = await boundedBody(request);
    if (body === null) return json({ error: "payload_too_large" }, 413);
    if (!await verifyDiscordSignature(body, signature, timestamp, String(env.DISCORD_PUBLIC_KEY || ""))) return json({ error: "invalid_signature" }, 401);
    let interaction: Interaction;
    try { interaction = JSON.parse(body); } catch { return json({ error: "invalid_json" }, 400); }
    if (!interaction || interaction.application_id !== env.DISCORD_APPLICATION_ID) return json({ error: "wrong_application" }, 403);
    if (interaction.type === 1) return json({ type: 1 });
    if (interaction.guild_id !== env.DISCORD_GUILD_ID || !isDiscordId(interaction.member?.user?.id)) return ephemeral("請在指定的 Discord 伺服器內使用會員驗證。");
    if (!isDiscordId(interaction.id) || typeof interaction.token !== "string" || !interaction.token || interaction.token.length > 1024) return json({ error: "invalid_interaction" }, 400);
    try { getConfig(env); } catch { return ephemeral("會員驗證服務尚未完成設定，請稍後再試或聯絡助理。"); }
    if ((interaction.type === 2 && interaction.data?.name === "verify") || (interaction.type === 3 && interaction.data?.custom_id === ids.verify)) return json(modal());
    const deferred = (interaction.type === 5 && interaction.data?.custom_id === ids.credentials) || (interaction.type === 3 && interaction.data?.custom_id === ids.sync);
    if (!deferred) return ephemeral("這個操作已不適用，請重新點擊會員驗證入口。");
    // Acknowledge within Discord's three-second window, before Notion/API work.
    const stub = env.MEMBER_GATE.get(env.MEMBER_GATE.idFromName(`guild:${interaction.guild_id}`));
    ctx.waitUntil(stub.processInteraction(interaction).catch((error: unknown) => console.error("gate_dispatch_failed", safeError(error))));
    return json({ type: 5, data: { flags: 64 } });
  },
};
