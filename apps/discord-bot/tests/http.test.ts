import { beforeAll, describe, expect, it, vi } from "vitest";
import { httpHandler, type HttpEnv } from "../src/http";
import { ids } from "../src/messages";
import { env, userId } from "./helpers";

describe("signed Discord interaction endpoint", () => {
  let keys: CryptoKeyPair;
  let publicKey: string;
  beforeAll(async () => {
    keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
    publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("hex");
  });
  const interaction = (extra = {}) => ({ id: "888888888888888888", application_id: env.DISCORD_APPLICATION_ID,
    guild_id: env.DISCORD_GUILD_ID, type: 2, token: "test-interaction-token", member: { user: { id: userId } }, data: { name: "verify" }, ...extra });
  async function request(body: unknown, timestamp = String(Math.floor(Date.now() / 1000))) {
    const text = JSON.stringify(body);
    const signature = Buffer.from(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + text))).toString("hex");
    return new Request("https://test.example/interactions", { method: "POST", body: text, headers: { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": timestamp } });
  }
  function context() {
    const processInteraction = vi.fn(async () => {});
    const waitUntil = vi.fn();
    const variables: HttpEnv = { ...env, DISCORD_PUBLIC_KEY: publicKey, MEMBER_GATE: { idFromName: (name) => name, get: () => ({ processInteraction }) } };
    return { processInteraction, variables, ctx: { waitUntil } as unknown as ExecutionContext, waitUntil };
  }
  it("responds to Discord's signed PING without requiring complete bot setup", async () => {
    const f = context(); delete f.variables.DISCORD_BOT_TOKEN;
    const response = await httpHandler.fetch(await request({ application_id: env.DISCORD_APPLICATION_ID, type: 1 }), f.variables, f.ctx);
    expect(await response.json()).toEqual({ type: 1 });
  });
  it("rejects invalid signatures and replayed timestamps before dispatch", async () => {
    const f = context(); const valid = await request(interaction());
    valid.headers.set("X-Signature-Ed25519", "0".repeat(128));
    expect((await httpHandler.fetch(valid, f.variables, f.ctx)).status).toBe(401);
    expect((await httpHandler.fetch(await request(interaction(), "1000000000"), f.variables, f.ctx)).status).toBe(401);
    expect(f.processInteraction).not.toHaveBeenCalled();
  });
  it("rejects another application and never processes another guild or DM", async () => {
    const f = context();
    expect((await httpHandler.fetch(await request(interaction({ application_id: "999999999999999999" })), f.variables, f.ctx)).status).toBe(403);
    for (const guild_id of [undefined, "999999999999999999"]) {
      const response = await httpHandler.fetch(await request(interaction({ guild_id })), f.variables, f.ctx);
      expect(await response.json()).toMatchObject({ type: 4, data: { flags: 64 } });
    }
    expect(f.processInteraction).not.toHaveBeenCalled();
  });
  it("opens a private Exchange ID and email modal without making external calls", async () => {
    const f = context();
    const response = await httpHandler.fetch(await request(interaction()), f.variables, f.ctx);
    expect(await response.json()).toMatchObject({ type: 9, data: { custom_id: ids.credentials, components: [{ type: 18, component: { type: 4, custom_id: "exchange_id" } }, { type: 18, component: { type: 4, custom_id: "email" } }] } });
    expect(f.processInteraction).not.toHaveBeenCalled();
  });
  it("acknowledges immediately while slow verification runs in waitUntil", async () => {
    const f = context(); let finish!: () => void;
    f.processInteraction.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const response = await httpHandler.fetch(await request(interaction({ type: 5, data: { custom_id: ids.credentials } })), f.variables, f.ctx);
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
    expect(f.waitUntil).toHaveBeenCalledTimes(1); finish();
  });
  it("serves no public administrative route", async () => {
    const f = context();
    expect((await httpHandler.fetch(new Request("https://test.example/admin"), f.variables, f.ctx)).status).toBe(404);
    expect((await httpHandler.fetch(new Request("https://test.example/interactions"), f.variables, f.ctx)).status).toBe(405);
  });
});
