import { describe, expect, it, vi } from "vitest";
import { getConfig, pageKey } from "../src/config";
import { evaluateMember } from "../src/membership";
import { DiscordClient } from "../src/discord";
import { NotionClient } from "../src/notion";
import { GateEngine } from "../src/engine";
import { digest } from "../src/crypto";
import { tierProof } from "../src/proof";
import { modal, field } from "../src/messages";
import { config, env, fixture, member, notionPage, now, userId } from "./helpers";
const v2 = { ...config, membershipPolicyV2Enabled: true };
const eligible = { ...member, exchange: "mexc" as const, status: "free", admissionVerifiedAt: "2026-01-01", volumeQualified: true, volumeCheckedAt: "2026-01-02" };
const evaluate = (changes = {}) => evaluateMember({ ...eligible, ...changes }, now, null, { [pageKey(member.pageId)]: "paid" }, "trial", true);

describe("v2 independent Notion facts", () => {
  it.each(["free", "active_volume", "active_paid"])("does not infer premium access from %s or an override", status => {
    expect(evaluate({ status, volumeQualified: false })).toEqual({ state: "allow", tier: "explorer", dueAt: null });
  });
  it("honors paid over qualified volume and independently falls back after expiry", () => {
    expect(evaluate({ paidAt: "2026-09-01" })).toMatchObject({ tier: "paid", dueAt: member.dueAt });
    expect(evaluate({ paidAt: "2026-09-01", dueAt: new Date(now).toISOString() })).toMatchObject({ tier: "volume", dueAt: null });
    expect(evaluate({ dueAt: "invalid" })).toMatchObject({ tier: "volume" });
  });
  it.each([{ paidAt: null }, { paidAt: "invalid" }, { paidAt: "2027-01-01" }, { paidAt: member.dueAt }, { dueAt: null }, { dueAt: "invalid" }])("requires valid independent paid facts: %j", changes => {
    expect(evaluate({ paidAt: "2026-01-01", volumeQualified: false, ...changes })).toMatchObject({ tier: "explorer" });
  });
  it.each([{}, { volumeCheckedAt: null }, { admissionVerifiedAt: null }, { volumeCheckedAt: "invalid" }, { volumeCheckedAt: "2027-01-01" }, { admissionVerifiedAt: "2027-01-01" }])("requires volume evidence; stale errors retain only prior successful qualification: %j", changes => {
    const result = evaluate({ volumeCheckError: "upstream unavailable", ...changes });
    expect(result).toMatchObject({ tier: Object.keys(changes).length ? "explorer" : "volume" });
  });
  it.each([["partner", "partner"], ["exempt", "non_expiring"], ["VIP", "non_expiring"], ["suspended", "explorer"], ["kicked", "explorer"], ["denied", "explorer"]])("priority for %s", (status, tier) => {
    expect(evaluate({ status, paidAt: "2026-09-01" })).toMatchObject({ tier });
  });
  it("defaults off and accepts Explorer role alias without changing legacy IDs", () => {
    expect(getConfig(env).membershipPolicyV2Enabled).toBe(false);
    expect(getConfig({ ...env, MEMBERSHIP_POLICY_V2_ENABLED: "true", DISCORD_TRIAL_ROLE_ID: undefined, DISCORD_EXPLORER_ROLE_ID: config.trialRoleId })).toMatchObject({ membershipPolicyV2Enabled: true, trialRoleId: config.trialRoleId });
  });
});

describe("v2 exchange identity", () => {
  it("offers all exchanges and reads select values from modal submissions", () => {
    const output = JSON.stringify(modal(true));
    for (const key of ["mexc", "bitget", "okx"]) expect(output).toContain(key);
    expect(field([{ type: 18, component: { type: 3, custom_id: "exchange", values: ["okx"] } }], "exchange")).toBe("okx");
  });
  it("matches exchange+UID+normalized Email and rejects duplicates within that exchange", async () => {
    const pages = [notionPage(), notionPage({ pageId: "00000000-0000-4000-8000-000000000002" })];
    Object.assign(pages[0]!.properties, { "Exchange Name": { type: "select", select: { name: "Mexc（抹茶）" } } });
    Object.assign(pages[1]!.properties, { "Exchange Name": { type: "select", select: { name: "Bitget" } } });
    const client = new NotionClient(v2, async () => Response.json({ results: pages, has_more: false }));
    expect((await client.findMember(member.exchangeId, member.email, "mexc"))?.pageId).toBe(member.pageId);
    expect((await client.findMember(member.exchangeId, member.email, "bitget"))?.pageId).toBe(pages[1]!.id);
    expect(await client.findMember(member.exchangeId, member.email, "okx")).toBeNull();
    Object.assign(pages[1]!.properties, { "Exchange Name": { type: "select", select: { name: "MEXC" } } });
    expect(await client.findMember(member.exchangeId, member.email, "mexc")).toBeNull();
  });
  it("reads exact successful volume facts and includes them in projected queries", async () => {
    const page = notionPage();
    Object.assign(page.properties, { "Exchange Name": { type: "select", select: { name: "OKX" } }, "Volume Qualified": { type: "checkbox", checkbox: true }, "Admission Verified At": { type: "date", date: { start: "2026-01-01" } }, "Volume Checked At": { type: "date", date: { start: "2026-01-02" } }, "Volume Check Error": { type: "rich_text", rich_text: [{ plain_text: "stale" }] } });
    const fetcher = vi.fn(async (_input: string | URL | Request) => Response.json({ results: [page], has_more: false }));
    expect(await new NotionClient(v2, fetcher).findMember(member.exchangeId, member.email, "okx")).toMatchObject({ exchange: "okx", volumeQualified: true, volumeCheckedAt: "2026-01-02", admissionVerifiedAt: "2026-01-01", volumeCheckError: "stale" });
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.searchParams.getAll("filter_properties")).toEqual(expect.arrayContaining(["Exchange Name", "Volume Qualified", "Admission Verified At", "Volume Checked At", "Volume Check Error"]));
  });
  it("migrates old verified HMAC only after checking proof and unique current identity, preserving verified time", async () => {
    const f = fixture(); f.change({ exchange: "mexc", status: "active_paid", paidAt: "2026-09-01" });
    const hash = await digest(config.authSecret, JSON.stringify(["discord-member-v1", userId, member.exchangeId, member.email]));
    const m = f.members.get(member.pageId)!;
    f.change({ discordId: userId, credentialHash: hash, tierProof: await tierProof(config.authSecret, m, userId, hash, "paid"), verifiedAt: now - 60_000 });
    const engine = new GateEngine(f.operations, f.services, v2, () => now);
    await engine.syncBatch("");
    const updated = f.members.get(member.pageId)!;
    expect(updated.credentialHash).toBe(await digest(config.authSecret, JSON.stringify(["discord-member-v2", userId, "mexc", member.exchangeId, member.email])));
    expect(updated.verifiedAt).toBe(now - 60_000);
    expect(f.services.findMember).toHaveBeenCalledWith(member.exchangeId, member.email, "mexc");
  });
  it.each(["bad-proof", "duplicate", "changed-exchange"])("requires reverification on legacy migration conflict: %s", async reason => {
    const f = fixture(); f.change({ exchange: reason === "changed-exchange" ? "bitget" : "mexc", status: "active_paid", paidAt: "2026-09-01" });
    const hash = await digest(config.authSecret, JSON.stringify(["discord-member-v1", userId, member.exchangeId, member.email]));
    const m = f.members.get(member.pageId)!;
    f.change({ discordId: userId, credentialHash: hash, tierProof: reason === "bad-proof" ? "paid:forged" : await tierProof(config.authSecret, m, userId, hash, "paid"), verifiedAt: now - 60_000 });
    if (reason === "duplicate") f.members.set("second", { ...m, pageId: "second" });
    await new GateEngine(f.operations, f.services, v2, () => now).syncBatch("");
    expect(f.members.get(member.pageId)!.credentialHash).toBe(hash);
    expect(f.services.applyRoles).toHaveBeenCalledWith(userId, { state: "allow", tier: "explorer", dueAt: null });
    expect(f.services.writeBinding).not.toHaveBeenCalled();
  });
  it("rejects an exchange edit between read and binding write", async () => {
    const expected = { ...member, exchange: "mexc" as const };
    const page = notionPage(); Object.assign(page.properties, { "Exchange Name": { type: "select", select: { name: "OKX" } } });
    const fetcher = vi.fn(async () => Response.json(page));
    await expect(new NotionClient(v2, fetcher).writeBinding(expected, { pageId: member.pageId, discordId: userId, credentialHash: "a".repeat(64), tierProof: null, verifiedAt: now })).rejects.toThrow("notion-binding-conflict");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("v2 default Explorer enumeration", () => {
  it("paginates complete guild pages preserving snowflake precision", async () => {
    const first = Array.from({ length: 10 }, (_, i) => ({ user: { id: String(111111111111111111n + BigInt(i)) }, roles: [], pending: false }));
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(first)).mockResolvedValueOnce(Response.json([]));
    const client = new DiscordClient(v2, fetcher);
    const page = await client.listGuildMembers("");
    expect(page.next).toBe(first.at(-1)!.user.id);
    expect(page.members).toHaveLength(10);
    expect(page.members[0]).toMatchObject({ discordId: userId });
    expect(await client.listGuildMembers(first.at(-1)!.user.id)).toEqual({ next: null, members: [] });
    expect(fetcher.mock.calls[1]![0]).toContain(`after=${first.at(-1)!.user.id}`);
  });
  it("skips bots, pending screening, configured roles; reports unbound premium without stripping", async () => {
    const f = fixture();
    const ids = [userId, "111111111111111112", "111111111111111113", "111111111111111114", "111111111111111115"];
    f.services.listGuildMembers = vi.fn(async () => ({ next: null, members: [
      { discordId: ids[0]!, roles: [], bot: false, pending: false },
      { discordId: ids[1]!, roles: [], bot: true, pending: false },
      { discordId: ids[2]!, roles: [], bot: false, pending: true },
      { discordId: ids[3]!, roles: [config.trialRoleId], bot: false, pending: false },
      { discordId: ids[4]!, roles: [config.memberRoleId, "foreign"], bot: false, pending: false },
    ] }));
    const result = await new GateEngine(f.operations, f.services, v2, () => now).defaultExplorerBatch("");
    expect(result).toMatchObject({ checked: 5, assigned: 1, review: 1, errors: 0 });
    expect(f.services.applyRoles).toHaveBeenCalledExactlyOnceWith(userId, { state: "allow", tier: "explorer", dueAt: null });
    expect(f.services.writeRole).not.toHaveBeenCalled();
  });
  it("does not mutate if Notion binding enumeration fails", async () => {
    const f = fixture(); f.services.listBoundMembers = vi.fn(async () => { throw new Error("unavailable"); });
    f.services.listGuildMembers = vi.fn(async () => ({ members: [], next: null }));
    await expect(new GateEngine(f.operations, f.services, v2).defaultExplorerBatch("")).rejects.toThrow();
    expect(f.services.applyRoles).not.toHaveBeenCalled();
  });
  it("never strips unbound premium during regular sync even if old tracking exists", async () => {
    const f = fixture(); await f.operations.trackRole(userId);
    await new GateEngine(f.operations, f.services, v2).syncBatch("");
    expect(f.services.applyRoles).not.toHaveBeenCalled();
  });
  it("rechecks new member screening, bots and premium roles before assigning Explorer", async () => {
    for (const current of [{ roles: [], user: { bot: true } }, { roles: [], pending: true }, { roles: [config.memberRoleId] }]) {
      const fetcher = vi.fn(async () => Response.json(current));
      await new DiscordClient(v2, fetcher).applyDefaultExplorer(userId);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("only changes configured roles on bound suspended members, leaving foreign roles", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ roles: [config.memberRoleId, "foreign"] })).mockImplementation(async () => new Response(null, { status: 204 }));
    await new DiscordClient(v2, fetcher).applyRoles(userId, evaluate({ status: "suspended" }));
    expect(fetcher.mock.calls.slice(1).map(([url, init]) => [String(url).split("/").at(-1), init.method])).toEqual([[config.memberRoleId, "DELETE"], [config.trialRoleId, "PUT"]]);
  });
});

describe("v2 role safety during conflicts and write failures", () => {
  it("downgrades expired paid membership before an unavailable proof update", async () => {
    const f = fixture(); f.change({ exchange: "mexc", status: "active_paid", paidAt: "2026-01-01", dueAt: "2026-02-01", discordId: userId,
      credentialHash: await digest(config.authSecret, JSON.stringify(["discord-member-v2", userId, "mexc", member.exchangeId, member.email])) });
    f.services.writeBinding = vi.fn(async () => { throw new Error("Notion unavailable"); });
    await new GateEngine(f.operations, f.services, v2, () => now).syncBatch("");
    expect(f.services.applyRoles).toHaveBeenCalledWith(userId, { state: "allow", tier: "explorer", dueAt: null });
  });
  it("does not strip premium roles on conflicting unbound Discord records", async () => {
    const f = fixture(); f.change({ discordId: userId });
    f.members.set("second", { ...member, pageId: "second", discordId: userId });
    await new GateEngine(f.operations, f.services, v2, () => now).syncBatch("");
    expect(f.services.applyRoles).not.toHaveBeenCalled();
  });
  it("does not auto-migrate a legacy proof missing its verified timestamp", async () => {
    const f = fixture(); f.change({ exchange: "mexc", status: "active_paid", paidAt: "2026-09-01" });
    const hash = await digest(config.authSecret, JSON.stringify(["discord-member-v1", userId, member.exchangeId, member.email]));
    const m = f.members.get(member.pageId)!;
    f.change({ discordId: userId, credentialHash: hash, tierProof: await tierProof(config.authSecret, m, userId, hash, "paid"), verifiedAt: null });
    await new GateEngine(f.operations, f.services, v2, () => now).syncBatch("");
    expect(f.services.writeBinding).not.toHaveBeenCalled();
    expect(f.services.applyRoles).toHaveBeenCalledWith(userId, { state: "allow", tier: "explorer", dueAt: null });
  });
});

it("uses Astronaut for V2 VIP even when legacy non-expiring role has a distinct ID", async () => {
  const legacyRole = "777777777777777777";
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ roles: [legacyRole, "foreign"] })).mockImplementation(async () => new Response(null, { status: 204 }));
  await new DiscordClient({ ...v2, nonExpiringRoleId: legacyRole }, fetcher).applyRoles(userId, evaluate({ status: "VIP" }));
  expect(fetcher.mock.calls.slice(1).map(([url, init]) => [String(url).split("/").at(-1), init.method])).toEqual([[legacyRole, "DELETE"], [config.memberRoleId, "PUT"]]);
});

it("rejects a duplicated exchange+UID even when only one duplicate has the submitted Email", async () => {
  const pages = [notionPage(), notionPage({ pageId: "00000000-0000-4000-8000-000000000002", email: "other@example.com" })];
  for (const page of pages) Object.assign(page.properties, { "Exchange Name": { type: "select", select: { name: "MEXC" } } });
  expect(await new NotionClient(v2, async () => Response.json({ results: pages, has_more: false })).findMember(member.exchangeId, member.email, "mexc")).toBeNull();
});

it.each(["bitget", "okx"] as const)("interactively verifies %s using exchange-bound HMAC without changing shared facts", async exchange => {
  const f = fixture(); f.change({ exchange, status: "free" });
  const reply = await new GateEngine(f.operations, f.services, v2, () => now).verify(userId, member.exchangeId, " MEMBER@EXAMPLE.COM ", exchange);
  expect(reply.content).toContain("探索者");
  expect(f.members.get(member.pageId)).toMatchObject({ exchange, status: "free", paidAt: null, dueAt: member.dueAt,
    credentialHash: await digest(config.authSecret, JSON.stringify(["discord-member-v2", userId, exchange, member.exchangeId, member.email])) });
});

it("rejects malformed or non-progressing guild pagination before any writes", async () => {
  for (const data of [[{ user: { id: userId }, roles: [] }], [{ user: { id: 111111111111111111 }, roles: [] }], [{ user: { id: "invalid" }, roles: [] }]]) {
    const fetcher = vi.fn(async () => Response.json(data));
    await expect(new DiscordClient(v2, fetcher).listGuildMembers(userId)).rejects.toThrow("discord-pagination");
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});

it.each(["", "   "])("does not grant premium from facts when Status is missing: %j", status => {
  expect(evaluate({ status, paidAt: "2026-09-01" })).toMatchObject({ state: "allow", tier: "explorer" });
});

it("replaces a revoked partner role using paid facts even if a proof refresh fails", async () => {
  const f = fixture(); f.change({ exchange: "mexc", status: "active_paid", paidAt: "2026-09-01", discordRole: "飛行員", discordId: userId,
    credentialHash: await digest(config.authSecret, JSON.stringify(["discord-member-v2", userId, "mexc", member.exchangeId, member.email])) });
  f.services.writeBinding = vi.fn(async () => { throw new Error("Notion unavailable"); });
  await new GateEngine(f.operations, f.services, v2, () => now).syncBatch("");
  expect(f.services.applyRoles).toHaveBeenCalledWith(userId, { state: "allow", tier: "paid", dueAt: member.dueAt });
});


describe("v2 requires migration review for ambiguous legacy statuses", () => {
  it.each(["payment_pending", "trial_active", "sent_7day_survey", "sent_3day_offer", "join_pending", "eligible", "renewal_due", "expired", "collecting_info", "unknown_legacy_status"])("does not elevate %s from historical payment and volume facts", status => {
    expect(evaluate({ status, paidAt: "2026-09-01" })).toEqual({ state: "review", reason: "ambiguous_tier" });
  });
  it.each(["payment_pending", "trial_active"])("keeps %s under review without independent evidence", status => {
    expect(evaluate({ status, paidAt: null, volumeQualified: false })).toEqual({ state: "review", reason: "ambiguous_tier" });
  });
  it("does not grant a new premium role when verifying an ambiguous legacy payment record", async () => {
    const f = fixture();
    f.change({ ...eligible, status: "payment_pending", paidAt: "2026-09-01" });
    const reply = await new GateEngine(f.operations, f.services, v2, () => now).verify(userId, member.exchangeId, member.email, "mexc");
    expect(reply.content).toContain("需要助理確認");
    const decisions = vi.mocked(f.services.applyRoles).mock.calls.map(([, decision]) => decision);
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every(decision => decision.state === "review")).toBe(true);
    expect(f.services.writeRole).not.toHaveBeenCalled();
    expect(f.members.get(member.pageId)!.tierProof).toBeNull();
  });
});

it.each(["payment_pending", "trial_active", "sent_7day_survey", "unknown_legacy_status"])("does not elevate legacy %s from volume-only evidence before migration", status => {
  expect(evaluate({ status, paidAt: null })).toEqual({ state: "review", reason: "ambiguous_tier" });
});
