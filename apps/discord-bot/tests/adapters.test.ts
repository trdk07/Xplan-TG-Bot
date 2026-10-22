import { describe, expect, it, vi } from "vitest";
import { DiscordClient } from "../src/discord";
import { evaluateMember } from "../src/membership";
import { NotionClient } from "../src/notion";
import type { Fetcher } from "../src/types";
import { config, member, notionPage, now, userId } from "./helpers";

const binding = { discordId: userId, pageId: member.pageId, credentialHash: "a".repeat(64), tierProof: null, verifiedAt: now };
describe("Notion membership adapter", () => {
  it("requires Exchange ID and Email to belong to the same row", async () => {
    const fetcher = vi.fn(async () => Response.json({ results: [
      notionPage({ exchangeId: "other-id" }),
      notionPage({ email: "other@example.com", pageId: "00000000-0000-4000-8000-000000000002" }),
    ], has_more: false }));
    expect(await new NotionClient(config, fetcher).findMember(member.exchangeId, member.email)).toBeNull();
  });
  it("distinguishes Exchange IDs with leading zeros", async () => {
    const fetcher = vi.fn(async () => Response.json({ results: [notionPage()], has_more: false }));
    expect(await new NotionClient(config, fetcher).findMember(String(Number(member.exchangeId)), member.email)).toBeNull();
  });
  it("normalizes email and completes pagination before accepting a unique match", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ results: [notionPage({ email: " MEMBER@EXAMPLE.COM " })], has_more: true, next_cursor: "next" }))
      .mockResolvedValueOnce(Response.json({ results: [], has_more: false, next_cursor: null }));
    const found = await new NotionClient(config, fetcher).findMember(member.exchangeId, member.email);
    expect(found?.pageId).toBe(member.pageId);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toContain(`/data_sources/${config.notionDataSourceId}/query?`);
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("manual");
      expect(init.headers["Notion-Version"]).toBe("2025-09-03");
      expect(JSON.parse(init.body).filter.property).toBe("Email");
    }
  });
  it("rejects duplicates even on a later page", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ results: [notionPage()], has_more: true, next_cursor: "next" }))
      .mockResolvedValueOnce(Response.json({ results: [notionPage({ pageId: "00000000-0000-4000-8000-000000000002" })], has_more: false }));
    expect(await new NotionClient(config, fetcher).findMember(member.exchangeId, member.email)).toBeNull();
  });
  it("rejects incomplete pagination instead of accepting a partial result", async () => {
    const fetcher = vi.fn(async () => Response.json({ results: [notionPage()], has_more: true, next_cursor: null }));
    await expect(new NotionClient(config, fetcher).findMember(member.exchangeId, member.email)).rejects.toThrow("notion-pagination");
  });
  it.each([403, 404, 429, 503])("propagates HTTP %s as unavailable, never as a missing member", async (status) => {
    await expect(new NotionClient(config, async () => new Response("", { status })).findMember(member.exchangeId, member.email)).rejects.toThrow();
  });
  it("checks the data source on direct reads and only uses GET", async () => {
    const fetcher = vi.fn<Fetcher>(async () => Response.json(notionPage()));
    expect(await new NotionClient(config, fetcher).getMember(member.pageId)).toEqual(member);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    const wrong = { ...notionPage(), parent: { data_source_id: "ffffffffffffffffffffffffffffffff" } };
    await expect(new NotionClient(config, async () => Response.json(wrong)).getMember(member.pageId)).rejects.toThrow("notion-schema");
  });
  it("writes only unique verification fields, preserving the exact large ID and shared member data", async () => {
    const id = "1546535242851029072", updated = { ...binding, discordId: "1546535242851029072" };
    const fetcher = vi.fn<Fetcher>()
      .mockResolvedValueOnce(Response.json(notionPage()))
      .mockResolvedValueOnce(Response.json(notionPage(updated)));
    const result = await new NotionClient(config, fetcher).writeBinding(member, updated);
    expect(result).toEqual({ ...member, ...updated });
    const [url, init] = fetcher.mock.calls[1]!;
    expect(url).toBe(`https://api.notion.com/v1/pages/${member.pageId}`);
    expect(init).toMatchObject({ method: "PATCH", redirect: "manual" });
    expect(JSON.parse(String(init?.body))).toEqual({ properties: {
      Discord_id: { rich_text: [{ type: "text", text: { content: id } }] },
      "Discord Credential Hash": { rich_text: [{ type: "text", text: { content: binding.credentialHash } }] },
      "Discord Tier Proof": { rich_text: [] },
      "Discord Verified At": { date: { start: new Date(now).toISOString() } },
    } });
  });
  it("does not issue a redundant write for an already matching binding", async () => {
    const fetcher = vi.fn<Fetcher>();
    await new NotionClient(config, fetcher).writeBinding({ ...member, ...binding }, binding);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("accepts Notion's minute precision for verification time without rounding membership dates", async () => {
    const requested = { ...binding, verifiedAt: now + 15_123 };
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce(Response.json(notionPage()))
      .mockResolvedValueOnce(Response.json(notionPage(binding)));
    const result = await new NotionClient(config, fetcher).writeBinding(member, requested);
    expect(result.verifiedAt).toBe(now);
    expect(result.dueAt).toBe(member.dueAt);
    const payload = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(payload.properties["Discord Verified At"].date.start).toBe(new Date(now).toISOString());
    expect(payload.properties).not.toHaveProperty("Review Due At");
  });
  it("recovers an already-written pending binding whose original timestamp included seconds", async () => {
    const fetcher = vi.fn<Fetcher>();
    const saved = { ...member, ...binding };
    const result = await new NotionClient(config, fetcher).writeBinding(saved, { ...binding, verifiedAt: now + 59_999 });
    expect(result).toEqual(saved);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("still rejects a write response with a verification time in a different minute", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce(Response.json(notionPage()))
      .mockResolvedValueOnce(Response.json(notionPage({ ...binding, verifiedAt: now - 60_000 })));
    await expect(new NotionClient(config, fetcher).writeBinding(member, { ...binding, verifiedAt: now + 15_123 })).rejects.toThrow("notion-write-unconfirmed");
  });
  it.each([
    { discordId: "999999999999999999" }, { email: "changed@example.com" },
    { exchangeId: "different" }, { archived: true },
  ])("rejects a conflicting or changed record before PATCH: %j", async (change) => {
    const fetcher = vi.fn<Fetcher>(async () => Response.json(notionPage(change)));
    await expect(new NotionClient(config, fetcher).writeBinding(member, binding)).rejects.toThrow("notion-binding-conflict");
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(["GET"]);
  });
  it.each([403, 429, 503])("surfaces write failure HTTP %s without claiming success", async (status) => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce(Response.json(notionPage()))
      .mockResolvedValueOnce(new Response(null, { status }));
    await expect(new NotionClient(config, fetcher).writeBinding(member, binding)).rejects.toThrow(`notion unavailable (${status})`);
  });
  it("rejects a successful HTTP response that did not persist the ID", async () => {
    const fetcher = vi.fn<Fetcher>(async () => Response.json(notionPage()));
    await expect(new NotionClient(config, fetcher).writeBinding(member, binding)).rejects.toThrow("notion-write-unconfirmed");
  });
  it("requires a text property rather than a number that could round Discord IDs", async () => {
    const page = notionPage();
    Object.assign(page.properties.Discord_id, { type: "number" });
    await expect(new NotionClient(config, async () => Response.json(page)).getMember(member.pageId)).rejects.toThrow("notion-discord-id-schema");
  });
  it("writes only the confirmed Discord role without modifying identity or membership fields", async () => {
    const bound = { ...member, discordId: userId, discordRole: "探索者" };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(notionPage(bound)))
      .mockResolvedValueOnce(Response.json(notionPage({ ...bound, discordRole: "飛行員" })));
    await new NotionClient(config, fetcher).writeRole(bound, "飛行員");
    expect(fetcher.mock.calls[1]![1]!.method).toBe("PATCH");
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body))).toEqual({ properties: { "Discord Role": { select: { name: "飛行員" } } } });
  });
  it("skips an unchanged role and clears a removed role with select null", async () => {
    const bound = { ...member, discordId: userId, discordRole: "宇航員" };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(notionPage(bound)))
      .mockResolvedValueOnce(Response.json(notionPage({ ...bound, discordRole: null })));
    const client = new NotionClient(config, fetcher);
    await client.writeRole(bound, "宇航員"); expect(fetcher).not.toHaveBeenCalled();
    await client.writeRole(bound, null);
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body))).toEqual({ properties: { "Discord Role": { select: null } } });
  });
  it("refuses a role write when the Notion binding changed in flight", async () => {
    const fetcher = vi.fn(async () => Response.json(notionPage({ discordId: "999999999999999999" })));
    await expect(new NotionClient(config, fetcher).writeRole({ ...member, discordId: userId }, "探索者")).rejects.toThrow("notion-binding-conflict");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports unconfirmed role writes and incompatible role fields", async () => {
    const bound = { ...member, discordId: userId };
    const fetcher = vi.fn(async () => Response.json(notionPage(bound)));
    await expect(new NotionClient(config, fetcher).writeRole(bound, "探索者")).rejects.toThrow("notion-role-write-unconfirmed");
    await expect(new NotionClient(config).writeRole({ ...bound, discordRole: undefined }, "探索者")).rejects.toThrow("notion-role-schema");
  });
});

describe("Discord role adapter", () => {
  it.each([
    ["Trial_active", "trialRoleId"], ["Active_Paid", "memberRoleId"], ["Eligible", "memberRoleId"],
    ["Exempt", "memberRoleId"], [" Partner ", "partnerRoleId"],
  ] as const)("assigns only the configured role for %s and preserves unrelated roles", async (status, roleKey) => {
    const desired = config[roleKey];
    const oldRoles = [config.trialRoleId, config.memberRoleId, config.partnerRoleId].filter(role => role !== desired);
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ roles: [...oldRoles, "free-role", "moderator-role"] }))
      .mockImplementation(async () => new Response(null, { status: 204 }));
    await new DiscordClient(config, fetcher).applyRoles(userId, evaluateMember({ ...member, status }, now));
    expect(fetcher.mock.calls.map(([url, init]) => [String(url).split("/").at(-1), init.method])).toEqual([
      [userId, "GET"], ...oldRoles.map(role => [role, "DELETE"]), [desired, "PUT"],
    ]);
  });
  it("downgrades paid to trial by removing stale access first, preserving all unrelated roles", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ roles: [config.memberRoleId, "free-role", "moderator-role"] }))
      .mockImplementation(async () => new Response(null, { status: 204 }));
    await new DiscordClient(config, fetcher).applyRoles(userId, { state: "allow", tier: "trial", dueAt: member.dueAt });
    expect(fetcher.mock.calls.map(([url, init]) => [String(url).split("/").at(-1), init.method])).toEqual([
      [userId, "GET"], [config.memberRoleId, "DELETE"], [config.trialRoleId, "PUT"],
    ]);
  });
  it("expiry removes only managed roles and never kicks the member", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ roles: [config.trialRoleId, config.memberRoleId, config.partnerRoleId, "free-role"] }))
      .mockImplementation(async () => new Response(null, { status: 204 }));
    await new DiscordClient(config, fetcher).applyRoles(userId, { state: "deny", reason: "expired" });
    expect(fetcher.mock.calls.slice(1).map(([url]) => String(url))).toEqual([
      `https://discord.com/api/v10/guilds/${config.guildId}/members/${userId}/roles/${config.trialRoleId}`,
      `https://discord.com/api/v10/guilds/${config.guildId}/members/${userId}/roles/${config.memberRoleId}`,
      `https://discord.com/api/v10/guilds/${config.guildId}/members/${userId}/roles/${config.partnerRoleId}`,
    ]);
  });
  it("does not bypass server rule screening", async () => {
    const fetcher = vi.fn(async () => Response.json({ roles: [], pending: true }));
    expect(await new DiscordClient(config, fetcher).applyRoles(userId, { state: "allow", tier: "paid", dueAt: member.dueAt })).toBe("screening_pending");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports an absent member distinctly from permission errors", async () => {
    expect(await new DiscordClient(config, async () => Response.json({ code: 10007 }, { status: 404 })).applyRoles(userId, { state: "deny", reason: "expired" })).toBe("not_in_guild");
    await expect(new DiscordClient(config, async () => new Response("", { status: 403 })).applyRoles(userId, { state: "deny", reason: "expired" })).rejects.toThrow();
  });
  it("does not mutate roles when classification needs review", async () => {
    const fetcher = vi.fn(async () => Response.json({ roles: [config.memberRoleId] }));
    await new DiscordClient(config, fetcher).applyRoles(userId, { state: "review", reason: "ambiguous_tier" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports failed role mutations and stops before adding a different role", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ roles: [config.memberRoleId] }))
      .mockResolvedValueOnce(Response.json({ retry_after: 1 }, { status: 429 }));
    await expect(new DiscordClient(config, fetcher).applyRoles(userId, { state: "allow", tier: "trial", dueAt: member.dueAt })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
