import { createHmac } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { GateEngine } from "../src/engine";
import {
  NotionClient,
  NotionBindingConflict,
  UpstreamError,
} from "../src/notion";
import { httpHandler } from "../src/http";
import {
  fixture,
  config,
  env,
  member,
  userId,
  now,
  notionPage,
} from "./helpers";
const secret = "synthetic-admin-secret-with-at-least-32-characters";
async function ready() {
  const f = fixture();
  const cfg = { ...config, membershipPolicyV2Enabled: true };
  f.change({
    exchange: "bitget",
    status: "active_paid",
    paidAt: "2026-09-01T00:00:00Z",
  });
  const clearBinding = vi.fn(async (expected: any) => {
    const current = f.members.get(expected.pageId)!;
    if (current.discordId !== expected.discordId)
      throw new NotionBindingConflict();
    f.members.set(current.pageId, {
      ...current,
      discordId: null,
      verifiedAt: null,
      credentialHash: null,
      tierProof: null,
      discordRole: null,
    });
  });
  (f.services as any).clearBinding = clearBinding;
  const engine = new GateEngine(f.operations, f.services, cfg, () => now);
  await engine.verify(userId, member.exchangeId, member.email, "bitget");
  vi.clearAllMocks();
  const request = (action = "unlink") => ({
    action,
    requestId: crypto.randomUUID(),
    pageId: member.pageId,
    discordId: userId,
    verifiedAt: now,
    operator: "Rick",
  });
  return { ...f, clearBinding, engine, cfg, request };
}
describe("admin role operations", () => {
  it("unlinks only after Explorer role cleanup and preserves paid/account facts", async () => {
    const f = await ready();
    f.services.applyRoles = vi.fn(async () => {
      expect(f.members.get(member.pageId)!.discordId).toBe(userId);
      return "updated" as const;
    });
    const result = await (f.engine as any).admin(f.request());
    expect(result.action).toBe("unlink");
    expect(f.services.applyRoles).toHaveBeenCalledWith(userId, {
      state: "allow",
      tier: "explorer",
      dueAt: null,
    });
    expect(f.members.get(member.pageId)).toMatchObject({
      discordId: null,
      verifiedAt: null,
      credentialHash: null,
      tierProof: null,
      discordRole: null,
      status: "active_paid",
      paidAt: "2026-09-01T00:00:00Z",
      exchangeId: member.exchangeId,
    });
  });
  it("syncs current Notion qualification immediately through the existing role path", async () => {
    const f = await ready();
    f.change({ status: "suspended" });
    await (f.engine as any).admin(f.request("sync"));
    expect(f.services.applyRoles).toHaveBeenCalledWith(userId, {
      state: "allow",
      tier: "explorer",
      dueAt: null,
    });
    expect(f.clearBinding).not.toHaveBeenCalled();
  });
  it.each([{ discordId: "999999999999999999" }, { verifiedAt: now + 60000 }])(
    "rejects stale binding %j before touching roles",
    async (change) => {
      const f = await ready();
      f.change(change);
      await expect((f.engine as any).admin(f.request())).rejects.toThrow();
      expect(f.services.applyRoles).not.toHaveBeenCalled();
      expect(f.clearBinding).not.toHaveBeenCalled();
    },
  );
  it("rejects duplicate Discord bindings rather than selecting a record", async () => {
    const f = await ready();
    f.members.set("other", {
      ...f.members.get(member.pageId)!,
      pageId: "00000000-0000-4000-8000-000000000002",
    });
    await expect((f.engine as any).admin(f.request())).rejects.toThrow();
    expect(f.services.applyRoles).not.toHaveBeenCalled();
  });
  it("deduplicates completed unlink requests across engine restarts and a new binding", async () => {
    const f = await ready();
    const request = f.request();
    const result = await (f.engine as any).admin(request);
    f.change({ discordId: userId, verifiedAt: now + 60000 });
    const restarted = new GateEngine(
      f.operations,
      f.services,
      f.cfg,
      () => now,
    );
    expect(await (restarted as any).admin(request)).toEqual(result);
    expect(f.clearBinding).toHaveBeenCalledTimes(1);
    expect(f.services.applyRoles).toHaveBeenCalledTimes(1);
  });
  it("retains binding on failed Discord cleanup and resumes the intent on cron", async () => {
    const f = await ready();
    vi.mocked(f.services.applyRoles).mockRejectedValueOnce(
      new UpstreamError("discord", 503),
    );
    await expect((f.engine as any).admin(f.request())).rejects.toThrow();
    expect(f.clearBinding).not.toHaveBeenCalled();
    expect(f.members.get(member.pageId)!.discordId).toBe(userId);
    const restarted = new GateEngine(
      f.operations,
      f.services,
      f.cfg,
      () => now,
    );
    await restarted.syncBatch("");
    expect(f.members.get(member.pageId)!.discordId).toBeNull();
    expect(
      vi
        .mocked(f.services.applyRoles)
        .mock.calls.every(
          ([, d]) => d.state === "allow" && d.tier === "explorer",
        ),
    ).toBe(true);
  });
  it("does not regrant paid roles while a failed Notion clear is pending", async () => {
    const f = await ready();
    f.clearBinding.mockRejectedValueOnce(new UpstreamError("notion", 503));
    await expect((f.engine as any).admin(f.request())).rejects.toThrow();
    await f.engine.syncBatch("");
    expect(f.members.get(member.pageId)!.discordId).toBeNull();
    expect(
      vi
        .mocked(f.services.applyRoles)
        .mock.calls.every(
          ([, d]) => d.state === "allow" && d.tier === "explorer",
        ),
    ).toBe(true);
  });
  it("blocks interactive verification while an unlink is pending", async () => {
    const f = await ready();
    f.clearBinding.mockRejectedValue(new UpstreamError("notion", 503));
    await expect((f.engine as any).admin(f.request())).rejects.toThrow();
    vi.clearAllMocks();
    await f.engine.verify(userId, member.exchangeId, member.email, "bitget");
    expect(f.services.writeBinding).not.toHaveBeenCalled();
    expect(f.services.applyRoles).not.toHaveBeenCalled();
  });
  it("confirms an unknown clear that already committed without stripping a replacement account", async () => {
    const f = await ready();
    const original = f.clearBinding.getMockImplementation()!;
    f.clearBinding.mockImplementationOnce(async (expected) => {
      await original(expected);
      throw new UpstreamError("network");
    });
    await expect((f.engine as any).admin(f.request())).rejects.toThrow();
    await f.engine.syncBatch("");
    expect(f.clearBinding).toHaveBeenCalledTimes(1);
    expect(f.services.applyRoles).toHaveBeenCalledTimes(1);
  });
  it("does not clear a screened member until role cleanup can finish", async () => {
    const f = await ready();
    vi.mocked(f.services.applyRoles).mockResolvedValue("screening_pending");
    await expect((f.engine as any).admin(f.request())).rejects.toThrow();
    expect(f.clearBinding).not.toHaveBeenCalled();
  });
});
it("does not revoke a replacement binding when legacy cron encounters a stale unlink", async () => {
  const f = await ready();
  f.clearBinding.mockRejectedValueOnce(new UpstreamError("notion", 503));
  await expect((f.engine as any).admin(f.request())).rejects.toThrow();
  f.change({
    exchangeId: "replacement-account",
    credentialHash: "c".repeat(64),
    verifiedAt: now + 60000,
  });
  vi.clearAllMocks();
  const legacy = new GateEngine(
    f.operations,
    f.services,
    { ...f.cfg, membershipPolicyV2Enabled: false },
    () => now,
  );
  const result = await legacy.syncBatch("");
  expect(result.errors).toBe(1);
  expect(f.services.applyRoles).not.toHaveBeenCalled();
  expect(f.clearBinding).not.toHaveBeenCalled();
});
describe("signed internal admin endpoint", () => {
  function setup() {
    const admin = vi.fn(async (r: any) => ({
      action: r.action,
      message: "done",
    }));
    return {
      admin,
      variables: {
        ...env,
        ADMIN_API_SECRET: secret,
        MEMBER_GATE: { idFromName: (n: string) => n, get: () => ({ admin }) },
      } as any,
      ctx: { waitUntil: vi.fn() } as any,
    };
  }
  const body = () => ({
    action: "sync",
    requestId: crypto.randomUUID(),
    pageId: member.pageId,
    discordId: userId,
    verifiedAt: now,
    operator: "Rick",
  });
  function signed(
    value: any,
    timestamp = String(Math.floor(Date.now() / 1000)),
  ) {
    const text = JSON.stringify(value);
    return new Request("https://test.example/internal/admin/member", {
      method: "POST",
      body: text,
      headers: {
        "Content-Type": "application/json",
        "X-Xplan-Admin-Timestamp": timestamp,
        "X-Xplan-Admin-Signature": createHmac("sha256", secret)
          .update(`${timestamp}\nPOST\n/internal/admin/member\n${text}`)
          .digest("hex"),
      },
    });
  }
  it("dispatches an authenticated strict request and never returns proof fields", async () => {
    const f = setup(),
      value = body();
    const r = await httpHandler.fetch(signed(value), f.variables, f.ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ action: "sync", message: "done" });
    expect(f.admin).toHaveBeenCalledWith(value);
  });
  it("rejects missing, altered and expired signatures", async () => {
    const f = setup();
    for (const r of [
      new Request("https://test.example/internal/admin/member", {
        method: "POST",
        body: "{}",
      }),
      signed(body(), "1000000000"),
    ])
      expect((await httpHandler.fetch(r, f.variables, f.ctx)).status).toBe(401);
    const altered = signed(body());
    altered.headers.set("X-Xplan-Admin-Signature", "0".repeat(64));
    expect((await httpHandler.fetch(altered, f.variables, f.ctx)).status).toBe(
      401,
    );
    expect(f.admin).not.toHaveBeenCalled();
  });
  it.each([
    { extra: "proof" },
    { action: "delete" },
    { action: ["sync"] },
    { operator: ["Rick"] },
    { pageId: "invalid" },
    { discordId: "123" },
    { operator: "unknown" },
    { verifiedAt: "yesterday" },
  ])("rejects invalid DTO %j before dispatch", async (change) => {
    const f = setup();
    expect(
      (
        await httpHandler.fetch(
          signed({ ...body(), ...change }),
          f.variables,
          f.ctx,
        )
      ).status,
    ).toBe(400);
    expect(f.admin).not.toHaveBeenCalled();
  });
  it("is disabled without its independent secret", async () => {
    const f = setup();
    delete f.variables.ADMIN_API_SECRET;
    expect(
      (await httpHandler.fetch(signed(body()), f.variables, f.ctx)).status,
    ).toBe(404);
    expect(f.admin).not.toHaveBeenCalled();
  });
  it("returns a safe conflict response for stale bindings", async () => {
    const f = setup();
    f.admin.mockRejectedValue(new NotionBindingConflict());
    const r = await httpHandler.fetch(signed(body()), f.variables, f.ctx);
    expect(r.status).toBe(409);
    expect(JSON.stringify(await r.json())).not.toContain(secret);
  });
});
describe("Notion clear binding contract", () => {
  it("clears only five DC properties and confirms the write", async () => {
    const expected = {
      ...member,
      discordId: userId,
      credentialHash: "a".repeat(64),
      tierProof: "b".repeat(64),
      verifiedAt: now,
      discordRole: "宇航員",
    };
    const fetcher = vi.fn(async (_url: any, init: any) =>
      init.method === "PATCH"
        ? Response.json(notionPage())
        : Response.json(notionPage(expected)),
    );
    await (new NotionClient(config, fetcher) as any).clearBinding(expected);
    const patches = fetcher.mock.calls.filter(
      ([, init]) => init.method === "PATCH",
    );
    const props = JSON.parse(patches[0]![1].body).properties;
    expect(Object.keys(props).sort()).toEqual(
      [
        "Discord_id",
        "Discord Verified At",
        "Discord Credential Hash",
        "Discord Tier Proof",
        "Discord Role",
      ].sort(),
    );
    expect(props.Discord_id.rich_text).toEqual([]);
    expect(props["Discord Verified At"].date).toBeNull();
  });
});
