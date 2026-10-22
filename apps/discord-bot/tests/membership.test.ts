import { describe, expect, it } from "vitest";
import { decisionMessage, evaluateMember } from "../src/membership";
import { getConfig, pageKey } from "../src/config";
import { env, member, now, userId } from "./helpers";

describe("shared Notion membership", () => {
  it.each([["trial_active", "trial"], ["active_paid", "paid"], ["eligible", "paid"], ["VIP", "non_expiring"], ["partner", "partner"], ["exempt", "non_expiring"]])("maps %s", (status, tier) => {
    expect(evaluateMember({ ...member, status }, now)).toMatchObject({ state: "allow", tier });
  });
  it.each(["expire", "expired", "kicked", "denied", "", " Expired "])("rejects %s", (status) => {
    expect(evaluateMember({ ...member, status }, now).state).toBe("deny");
  });
  it.each(["collecting_info", "invite_sent", "join_pending", "sent_7day_survey", "sent_3day_offer", "user_refused", "renewal_due", "payment_pending", "custom_valid_status"])("allows existing %s records without creating or resetting a trial", (status) => {
    expect(evaluateMember({ ...member, status }, now)).toEqual({ state: "allow", tier: "trial", dueAt: member.dueAt });
  });
  it("honors the exact shared deadline, with no automatic grace", () => {
    expect(evaluateMember({ ...member, dueAt: new Date(now).toISOString(), paymentDeadlineAt: "2027-01-01" }, now)).toEqual({ state: "deny", reason: "expired" });
    expect(evaluateMember({ ...member, dueAt: "2026-09-08" }, now).state).toBe("deny");
  });
  it("handles incomplete data according to policy but never invents a date", () => {
    expect(evaluateMember({ ...member, dueAt: null }, now)).toEqual({ state: "allow", tier: "trial", dueAt: null });
    expect(evaluateMember({ ...member, dueAt: null }, now, null, {}, "review").state).toBe("review");
    expect(evaluateMember({ ...member, dueAt: "invalid" }, now).state).toBe("review");
    expect(evaluateMember({ ...member, status: "sent_3day_offer" }, now, null, {}, "review").state).toBe("review");
  });
  it.each(["active_paid", "eligible"])("keeps the explicit formal role for %s without inventing a missing deadline", (status) => {
    expect(evaluateMember({ ...member, status, dueAt: null }, now)).toEqual({ state: "allow", tier: "paid", dueAt: null });
    expect(evaluateMember({ ...member, status, dueAt: "2020-01-01" }, now).state).toBe("deny");
  });
  it("never grants archived non-expiring members", () => {
    expect(evaluateMember({ ...member, status: "VIP", archived: true }, now).state).toBe("deny");
  });
  it.each([[" Partner ", "飛行員"], ["Exempt", "宇航員"]])("preserves non-expiring membership and names the role for %s", (status, role) => {
    const decision = evaluateMember({ ...member, status, dueAt: "2020-01-01" }, now);
    expect(decision).toMatchObject({ state: "allow", dueAt: null });
    expect(decisionMessage(decision)).toContain(`「${role}」`);
    expect(decisionMessage(decision)).toContain("不受續費期限限制");
    expect(evaluateMember({ ...member, status, archived: true }, now).state).toBe("deny");
  });
  it("does not carry partner access forward after the status changes to a reminder", () => {
    const previous = { discordId: userId, pageId: member.pageId, credentialHash: "h", tier: "partner" as const, dueAt: member.dueAt, paidAt: member.paidAt, verifiedAt: now };
    expect(evaluateMember({ ...member, status: "sent_3day_offer" }, now, previous)).toMatchObject({ state: "allow", tier: "trial" });
  });
  it("recognizes TG paid rejoin with a valid payment and future term", () => {
    expect(evaluateMember({ ...member, status: "join_pending", paidAt: "2026-09-01" }, now)).toMatchObject({ state: "allow", tier: "paid" });
  });
  it("does not infer paid tier from a historical payment in reminder states", () => {
    expect(evaluateMember({ ...member, status: "sent_3day_offer", paidAt: "2025-01-01" }, now)).toMatchObject({ state: "allow", tier: "trial" });
  });
  it("remembers only a confirmed classification for the same membership term", () => {
    const previous = { discordId: userId, pageId: member.pageId, credentialHash: "h", tier: "paid" as const, dueAt: member.dueAt, paidAt: member.paidAt, verifiedAt: now };
    const reminded = { ...member, status: "sent_3day_offer" };
    expect(evaluateMember(reminded, now, previous)).toMatchObject({ state: "allow", tier: "paid" });
    expect(evaluateMember({ ...reminded, dueAt: "2027-01-01" }, now, previous)).toMatchObject({ state: "allow", tier: "trial" });
  });
  it("explicit tier resolution cannot bypass expiry", () => {
    const overrides = { [pageKey(member.pageId)]: "paid" as const };
    expect(evaluateMember({ ...member, status: "sent_3day_offer" }, now, null, overrides)).toMatchObject({ state: "allow", tier: "paid" });
    expect(evaluateMember({ ...member, status: "sent_3day_offer", dueAt: "2026-01-01" }, now, null, overrides).state).toBe("deny");
  });
  it("rejects invalid role and secret configuration", () => {
    expect(() => getConfig({ ...env, DISCORD_TRIAL_ROLE_ID: env.DISCORD_MEMBER_ROLE_ID })).toThrow();
    expect(() => getConfig({ ...env, DISCORD_TRIAL_ROLE_ID: env.DISCORD_GUILD_ID })).toThrow();
    expect(() => getConfig({ ...env, DISCORD_PARTNER_ROLE_ID: undefined })).toThrow();
    for (const role of [env.DISCORD_TRIAL_ROLE_ID, env.DISCORD_MEMBER_ROLE_ID, env.DISCORD_GUILD_ID]) {
      expect(() => getConfig({ ...env, DISCORD_PARTNER_ROLE_ID: role })).toThrow();
    }
    expect(() => getConfig({ ...env, DISCORD_NON_EXPIRING_ROLE_ID: env.DISCORD_PARTNER_ROLE_ID })).toThrow();
    expect(() => getConfig({ ...env, AUTH_SECRET: "short" })).toThrow();
    expect(getConfig(env).notionEmailProperty).toBe("Email");
  });
});
