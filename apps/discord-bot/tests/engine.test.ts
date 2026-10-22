import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GateEngine } from "../src/engine";
import { UpstreamError } from "../src/notion";
import { previousBinding, tierProof } from "../src/proof";
import { ids } from "../src/messages";
import { config, fixture, member, now, userId } from "./helpers";

describe("Notion-only membership bindings", () => {
  let f: ReturnType<typeof fixture>, engine: GateEngine, time: number;
  beforeEach(() => { f = fixture(); time = now; engine = new GateEngine(f.operations, f.services, config, () => time); });
  afterEach(() => vi.restoreAllMocks());
  const verify = () => engine.verify(userId, member.exchangeId, member.email);
  const record = () => f.members.get(member.pageId)!;
  it("persists identity and proofs in Notion before granting, without date copies", async () => {
    await engine.verify(userId, ` ${member.exchangeId} `, " MEMBER@EXAMPLE.COM ");
    expect(record()).toMatchObject({ discordId: userId, verifiedAt: now, dueAt: member.dueAt });
    expect(record().credentialHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record().tierProof).not.toContain(member.dueAt!);
    expect(await previousBinding(config.authSecret, record())).toMatchObject({ tier: "trial" });
    expect(await f.operations.pending()).toEqual([]);
    expect(f.services.applyRoles).toHaveBeenCalledWith(userId, { state: "allow", tier: "trial", dueAt: member.dueAt });
    expect(vi.mocked(f.services.writeBinding).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.services.applyRoles).mock.invocationCallOrder[0]!);
    expect(record().discordRole).toBe("探索者");
    expect(vi.mocked(f.services.applyRoles).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.services.writeRole).mock.invocationCallOrder[0]!);
  });
  it("requires both credentials and reveals no partial match", async () => {
    await engine.verify(userId, "", member.email);
    const a = await engine.verify(userId, "wrong", member.email), b = await engine.verify(userId, member.exchangeId, "wrong@example.com");
    expect(a).toEqual(b); expect(record().discordId).toBeNull(); expect(f.services.applyRoles).not.toHaveBeenCalled();
  });
  it.each(["expire", "expired", "denied", "kicked", ""])("does not bind or grant a new %s member", async status => {
    f.change({status}); await verify(); expect(f.services.writeBinding).not.toHaveBeenCalled(); expect(f.services.applyRoles).not.toHaveBeenCalled();
  });
  it("serializes concurrent first-time claims of the same member", async () => {
    await Promise.all([verify(), engine.verify("999999999999999999", member.exchangeId, member.email)]);
    expect(record().discordId).toBe(userId); expect(f.services.applyRoles).toHaveBeenCalledTimes(1);
  });
  it("cannot switch a Discord account to another Notion member", async () => {
    await verify(); const other = { ...member, pageId: "00000000-0000-4000-8000-000000000002", exchangeId: "other" }; f.members.set(other.pageId, other);
    await engine.verify(userId, "other", member.email);
    expect(f.members.get(other.pageId)?.discordId).toBeNull();
  });
  it("prevents cross-page claims while the first Notion write outcome is unknown", async () => {
    vi.mocked(f.services.writeBinding).mockRejectedValueOnce(new UpstreamError("notion", 503));
    await expect(verify()).rejects.toThrow(); expect(f.services.applyRoles).not.toHaveBeenCalled();
    const other = { ...member, pageId: "00000000-0000-4000-8000-000000000002", exchangeId: "other" }; f.members.set(other.pageId, other);
    await engine.verify(userId, "other", member.email);
    expect(f.members.get(other.pageId)?.discordId).toBeNull();
    engine = new GateEngine(f.operations, f.services, config, () => time);
    expect(await engine.syncBatch("")).toMatchObject({ errors: 0, checked: 1 });
    expect(record().discordId).toBe(userId); expect(await f.operations.pending()).toEqual([]);
  });
  it("retains rate limits and deduplication across engine restarts", async () => {
    vi.mocked(f.services.findMember).mockResolvedValue(null);
    for (let i=0;i<5;i++) await verify();
    engine = new GateEngine(f.operations, f.services, config, () => time); await verify();
    expect(f.services.findMember).toHaveBeenCalledTimes(5);
    time += 15*60_000; await verify(); expect(f.services.findMember).toHaveBeenCalledTimes(6);
  });
  it("recovers membership entirely from Notion after operational state is lost", async () => {
    await verify(); const fresh = fixture();
    engine = new GateEngine(fresh.operations, f.services, config, () => time);
    await engine.syncBatch("");
    expect(f.services.applyRoles).toHaveBeenLastCalledWith(userId, expect.objectContaining({state:"allow"}));
  });
  it("retains paid classification through reminders, invalidates it on a new term, and expires", async () => {
    await verify(); f.change({status:"active_paid",paidAt:"2026-09-01",dueAt:"2026-12-01"}); await engine.syncBatch("");
    f.change({status:"sent_3day_offer"}); engine = new GateEngine(f.operations,f.services,config,()=>time); await engine.syncBatch("");
    expect(f.services.applyRoles).toHaveBeenLastCalledWith(userId,{state:"allow",tier:"paid",dueAt:"2026-12-01"});
    f.change({dueAt:"2027-01-01"}); await engine.syncBatch("");
    expect(f.services.applyRoles).toHaveBeenLastCalledWith(userId,{state:"allow",tier:"trial",dueAt:"2027-01-01"});
    time=Date.parse("2027-01-01"); await engine.syncBatch("");
    expect(f.services.applyRoles).toHaveBeenLastCalledWith(userId,{state:"deny",reason:"expired"});
  });
  it("migrates an existing partner proof and follows subsequent status changes without reverification", async () => {
    f.change({ status: "partner" }); await verify();
    f.change({ tierProof: await tierProof(config.authSecret, record(), userId, record().credentialHash!, "non_expiring") });
    const identity = { discordId: record().discordId, credentialHash: record().credentialHash, verifiedAt: record().verifiedAt };
    expect(await engine.syncBatch("")).toMatchObject({ checked: 1, errors: 0 });
    expect(await previousBinding(config.authSecret, record())).toMatchObject({ tier: "partner" });
    expect(record()).toMatchObject({ ...identity, dueAt: member.dueAt, paidAt: member.paidAt });
    expect(f.services.applyRoles).toHaveBeenLastCalledWith(userId, { state: "allow", tier: "partner", dueAt: null });
    const writes = vi.mocked(f.services.writeBinding).mock.calls.length;
    await engine.syncBatch(""); expect(f.services.writeBinding).toHaveBeenCalledTimes(writes);
    f.change({ status: "exempt" }); await engine.syncBatch("");
    expect(f.services.applyRoles).toHaveBeenLastCalledWith(userId, { state: "allow", tier: "non_expiring", dueAt: null });
    f.change({ status: "partner" }); await engine.syncBatch("");
    f.change({ status: "denied" }); await engine.syncBatch("");
    expect(f.services.applyRoles).toHaveBeenLastCalledWith(userId, { state: "deny", reason: "blocked" });
  });
  it.each(["email","exchangeId","discordId"])("requires reverification when %s changes", async field => {
    await verify(); f.change({[field]:field === "discordId" ? "999999999999999999" : "changed"}); await engine.syncBatch("");
    expect(vi.mocked(f.services.applyRoles).mock.calls.slice(1).every(([,d])=>d.state==="deny")).toBe(true);
  });
  it("revokes orphan roles when a Notion row is archived or its binding cleared", async () => {
    await verify(); f.change({archived:true}); await engine.syncBatch("");
    expect(f.services.applyRoles).toHaveBeenLastCalledWith(userId,{state:"deny",reason:"blocked"});
  });
  it("never interprets a failed enumeration as all memberships missing", async () => {
    await verify(); vi.mocked(f.services.listBoundMembers).mockRejectedValue(new UpstreamError("notion",503));
    await expect(engine.syncBatch("")).rejects.toThrow(); expect(f.services.applyRoles).toHaveBeenCalledTimes(1);
  });
  it("revokes expiry without writing metadata", async () => {
    await verify(); f.change({dueAt:"2020-01-01"}); vi.mocked(f.services.writeBinding).mockRejectedValue(new UpstreamError("notion",403));
    expect(await engine.syncBatch("")).toMatchObject({errors:0});
    expect(f.services.applyRoles).toHaveBeenLastCalledWith(userId,{state:"deny",reason:"expired"});
  });
  it("blocks duplicate manually edited Notion Discord IDs", async () => {
    await verify(); f.members.set("other",{...record(),pageId:"other"}); await engine.syncBatch("");
    expect(f.services.applyRoles).toHaveBeenLastCalledWith(userId,{state:"deny",reason:"blocked"});
  });
  it("deduplicates signed interaction retries", async () => {
    const interaction={id:"888888888888888888",type:5,application_id:config.applicationId,token:"test",member:{user:{id:userId}},data:{custom_id:ids.credentials,components:[
      {type:18,component:{type:4,custom_id:"email",value:member.email}}, {type:18,component:{type:4,custom_id:"exchange_id",value:member.exchangeId}}]}};
    await Promise.all([engine.process(interaction),engine.process(interaction)]);
    engine=new GateEngine(f.operations,f.services,config,()=>time); await engine.process(interaction);
    expect(f.services.reply).toHaveBeenCalledTimes(1);
  });
  it("records role changes, ignores manually edited role results for authorization, and clears revocation", async () => {
    await verify();
    f.change({ discordRole: "飛行員" }); await engine.syncBatch("");
    expect(record().discordRole).toBe("探索者");
    expect(f.services.applyRoles).toHaveBeenLastCalledWith(userId, expect.objectContaining({ tier: "trial" }));
    f.change({ status: "partner" }); await engine.syncBatch(""); expect(record().discordRole).toBe("飛行員");
    f.change({ status: "exempt" }); await engine.syncBatch(""); expect(record().discordRole).toBe("宇航員");
    f.change({ status: "expired" }); await engine.syncBatch(""); expect(record().discordRole).toBeNull();
  });
  it("does not record a role when Discord rejects the mutation", async () => {
    vi.mocked(f.services.applyRoles).mockRejectedValueOnce(new UpstreamError("discord", 403));
    await expect(verify()).rejects.toThrow("discord");
    expect(f.services.writeRole).not.toHaveBeenCalled(); expect(record().discordRole).toBeNull();
    await engine.syncBatch(""); expect(record().discordRole).toBe("探索者");
  });
  it("retries a failed Notion role write from fresh membership without reverting successful Discord access", async () => {
    vi.mocked(f.services.writeRole).mockRejectedValueOnce(new UpstreamError("notion", 503));
    await expect(verify()).rejects.toThrow("notion-role-sync");
    expect(record().discordId).toBe(userId); expect(record().discordRole).toBeNull();
    expect(f.services.applyRoles).toHaveBeenCalledTimes(1);
    await engine.syncBatch(""); expect(record().discordRole).toBe("探索者");
  });
  it("revokes before a failing role-record write and retains retry tracking", async () => {
    await verify(); f.change({ status: "expired" });
    vi.mocked(f.services.writeRole).mockRejectedValueOnce(new UpstreamError("notion", 503));
    expect(await engine.syncBatch("")).toMatchObject({ errors: 1 });
    expect(f.services.applyRoles).toHaveBeenLastCalledWith(userId, { state: "deny", reason: "blocked" });
    expect(await f.operations.roleTargets()).toContain(userId);
    expect(await engine.syncBatch("")).toMatchObject({ errors: 0 });
    expect(record().discordRole).toBeNull(); expect(await f.operations.roleTargets()).not.toContain(userId);
  });
  it("does not record a grant during screening or review and clears records for members outside the guild", async () => {
    vi.mocked(f.services.applyRoles).mockResolvedValueOnce("screening_pending");
    await verify(); expect(f.services.writeRole).not.toHaveBeenCalled();
    await engine.syncBatch(""); expect(record().discordRole).toBe("探索者");
    f.change({ dueAt: "bad-date" }); await engine.syncBatch("");
    expect(record().discordRole).toBe("探索者"); expect(f.services.writeRole).toHaveBeenCalledTimes(1);
    vi.mocked(f.services.applyRoles).mockResolvedValueOnce("not_in_guild");
    await engine.syncBatch(""); expect(record().discordRole).toBeNull();
  });
});
