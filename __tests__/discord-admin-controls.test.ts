import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { createHmac } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { runDiscordAdmin } from "@/lib/discord-admin";
import { DiscordAdminControls } from "@/app/admin/components/DiscordAdminControls";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  lock: vi.fn(),
  remote: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth", () => ({
  assertAdminAction: mocks.auth,
  getAdminOperator: async () => "Rick",
  setAdminCookie: vi.fn(),
  clearAdminCookie: vi.fn(),
}));
vi.mock("@/lib/notion", () => ({
  getMemberByPageId: mocks.read,
  updateMember: mocks.write,
  updateMemberExistingProperties: mocks.write,
  listMembers: vi.fn(),
}));
vi.mock("@/lib/qualification", () => ({
  withQualificationLock: mocks.lock,
  recheckQualifications: vi.fn(),
  reserveBoundAccount: vi.fn(),
}));
vi.mock("@/lib/discord-admin", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  requestDiscordAdmin: (...args: any[]) => mocks.remote(...args),
}));
import {
  syncDiscordRoleAction,
  unlinkDiscordAction,
} from "@/app/admin/actions";
const pageId = "00000000-0000-4000-8000-000000000001",
  discordId = "111111111111111111",
  verifiedAt = "2026-10-01T01:00:00Z";
const request = {
  action: "sync",
  requestId: "00000000-0000-4000-8000-000000000002",
  pageId,
  discordId,
  verifiedAt: Date.parse(verifiedAt),
  operator: "Rick",
} as const;
const secret = "test-only-shared-admin-secret-long-enough";
const environment = {
  DISCORD_ADMIN_API_URL: "https://dc.example",
  DISCORD_ADMIN_API_SECRET: secret,
};
const previous = { kind: "idle", message: "" } as const;
beforeEach(() => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  mocks.auth.mockResolvedValue(undefined);
  mocks.read.mockResolvedValue({
    pageId,
    discordId,
    discordVerifiedAt: verifiedAt,
    status: "active_paid",
  });
  mocks.lock.mockImplementation(async (_id: string, work: any) =>
    work(async () => {}),
  );
  mocks.remote.mockResolvedValue({ action: "sync", message: "已同步探索者" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe("signed dashboard client", () => {
  it("signs the fixed HTTPS endpoint and keeps secrets out of payload", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ action: "sync", message: "已同步探索者" }),
    );
    const now = Date.parse("2026-10-29T01:00:00Z");
    await runDiscordAdmin(request, { environment, fetcher, now });
    const [url, init] = fetcher.mock.calls[0] as any;
    expect(url).toBe("https://dc.example/internal/admin/member");
    expect(init.redirect).toBe("manual");
    const signature = createHmac("sha256", secret)
      .update(
        `${Math.floor(now / 1000)}\nPOST\n/internal/admin/member\n${init.body}`,
      )
      .digest("hex");
    expect(init.headers["X-Xplan-Admin-Signature"]).toBe(signature);
    expect(init.body).not.toContain(secret);
  });
  it.each([
    {},
    { ...environment, DISCORD_ADMIN_API_URL: "http://dc.example" },
    {
      ...environment,
      DISCORD_ADMIN_API_URL: "https://user:password@dc.example",
    },
    { ...environment, DISCORD_ADMIN_API_SECRET: "short" },
  ])("refuses absent or unsafe configuration", async (env) => {
    const fetcher = vi.fn();
    await expect(
      runDiscordAdmin(request, { environment: env, fetcher }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects malformed success and never exposes raw remote errors", async () => {
    for (const response of [
      Response.json({ action: "sync", message: "ok", proof: "private" }),
      Response.json({ error: secret }, { status: 502 }),
    ]) {
      await expect(
        runDiscordAdmin(request, {
          environment,
          fetcher: async () => response,
        }),
      ).rejects.not.toThrow(secret);
    }
  });
  it("does not retry a timeout or follow a redirect", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("secret upstream details");
    });
    await expect(
      runDiscordAdmin(request, { environment, fetcher }),
    ).rejects.not.toThrow("secret upstream details");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
describe("authenticated actions", () => {
  it("requires admin authentication before reads, writes or Bot calls", async () => {
    mocks.auth.mockRejectedValue(new Error("Unauthorized"));
    await expect(
      syncDiscordRoleAction(
        pageId,
        discordId,
        verifiedAt,
        previous,
        new FormData(),
      ),
    ).rejects.toThrow("Unauthorized");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.remote).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("holds the qualification lease and records actor/result without writing DC fields", async () => {
    let locked = false;
    mocks.lock.mockImplementation(async (_id: string, fn: any) => {
      locked = true;
      try {
        return await fn(async () => {});
      } finally {
        locked = false;
      }
    });
    mocks.remote.mockImplementation(async () => {
      expect(locked).toBe(true);
      return { action: "sync", message: "已同步探索者" };
    });
    const result = await syncDiscordRoleAction(
      pageId,
      discordId,
      verifiedAt,
      previous,
      new FormData(),
    );
    expect(result.kind).toBe("success");
    expect(mocks.remote).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sync",
        pageId,
        discordId,
        verifiedAt: Date.parse(verifiedAt),
        operator: "Rick",
      }),
    );
    expect(mocks.write).toHaveBeenCalledWith(
      pageId,
      expect.objectContaining({
        lastBotMessage: expect.stringContaining("Rick"),
      }),
    );
    expect(Object.keys(mocks.write.mock.calls[0][1]).sort()).toEqual([
      "lastBotCheckAt",
      "lastBotMessage",
    ]);
  });
  it("rejects a stale displayed Discord identity", async () => {
    mocks.read.mockResolvedValue({
      pageId,
      discordId: "999999999999999999",
      discordVerifiedAt: verifiedAt,
    });
    const result = await syncDiscordRoleAction(
      pageId,
      discordId,
      verifiedAt,
      previous,
      new FormData(),
    );
    expect(result.kind).toBe("error");
    expect(mocks.remote).not.toHaveBeenCalled();
  });
  it("requires explicit unlink confirmation on the server", async () => {
    const result = await unlinkDiscordAction(
      pageId,
      discordId,
      verifiedAt,
      previous,
      new FormData(),
    );
    expect(result.kind).toBe("error");
    expect(mocks.remote).not.toHaveBeenCalled();
  });
  it("requests a confirmed unlink through the Bot and preserves membership facts", async () => {
    mocks.remote.mockResolvedValue({ action: "unlink", message: "已解除綁定" });
    const form = new FormData();
    form.set("confirmUnlink", "yes");
    expect(
      (await unlinkDiscordAction(pageId, discordId, verifiedAt, previous, form))
        .kind,
    ).toBe("success");
    expect(mocks.remote).toHaveBeenCalledWith(
      expect.objectContaining({ action: "unlink" }),
    );
    for (const [, patch] of mocks.write.mock.calls)
      expect(
        Object.keys(patch).every((k) =>
          ["lastBotCheckAt", "lastBotMessage"].includes(k),
        ),
      ).toBe(true);
  });
  it("does not claim success or clear binding when the Bot cannot confirm", async () => {
    mocks.remote.mockRejectedValue(new Error("network"));
    const result = await syncDiscordRoleAction(
      pageId,
      discordId,
      verifiedAt,
      previous,
      new FormData(),
    );
    expect(result.kind).toBe("error");
    expect(mocks.write.mock.calls.every(([, p]) => !("discordId" in p))).toBe(
      true,
    );
  });
});
describe("dashboard UI", () => {
  it("renders both operations, confirmation and configuration explanation", () => {
    const html = renderToStaticMarkup(
      createElement(DiscordAdminControls, {
        pageId,
        discordId,
        verifiedAt,
        configured: false,
      }),
    );
    expect(html).toContain("立即同步 DC 角色");
    expect(html).toContain("解除 DC 綁定");
    expect(html).toContain("confirmUnlink");
    expect(html).toContain("disabled");
    expect(html).not.toContain("Credential Hash");
    const directory = process.env.DISCORD_CONTROLS_PREVIEW;
    if (directory) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        `${directory}/globals.css`,
        readFileSync("app/globals.css"),
      );
      const enabled = renderToStaticMarkup(
        createElement(DiscordAdminControls, {
          pageId,
          discordId,
          verifiedAt,
          configured: true,
        }),
      );
      writeFileSync(
        `${directory}/index.html`,
        `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="globals.css"><title>DC 管理操作預覽（合成資料）</title></head><body><main class="shell"><h1>會員詳細資料 — 測試會員</h1><p>以下為本機合成測試資料，未連線真實 Discord。</p><section class="panel"><div class="panel-head"><h3>管理操作</h3></div><div class="stack">${enabled}</div></section></main></body></html>`,
      );
    }
  });
});
