import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Member } from "@/lib/notion";

const state = vi.hoisted(() => ({
  member: null as Member | null,
  telegram: [] as string[],
  messages: [] as string[],
  reminderStages: [] as string[],
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  assertAdminAction: vi.fn(), getAdminOperator: async () => "助理",
  clearAdminCookie: vi.fn(), setAdminCookie: vi.fn(),
}));
vi.mock("@/lib/config", () => ({
  getAdminPassword: () => "test", getRuntimeConfig: () => ({ paymentGraceDays: 3 }),
}));
vi.mock("@/lib/bot", () => ({
  manualPaymentProofRequestMessage: () => "請提供付款資料",
  paymentProofRequestKeyboard: () => undefined,
  sendRenewalReminder: async (_member: Member, _now: Date, _reason: string, stage = "7day") => { state.reminderStages.push(stage); },
}));
vi.mock("@/lib/notion", () => ({
  getMemberByPageId: async () => state.member,
  listMembers: async () => state.member ? [state.member] : [],
  updateMember: async (_id: string, patch: Partial<Member>) => Object.assign(state.member!, patch),
  updateMemberExistingProperties: async (_id: string, patch: Partial<Member>) => {
    Object.assign(state.member!, patch);
    return Object.keys(patch).map((key) => key === "status" ? "Status" : key === "renewalStep" ? "Renewal Step" : key);
  },
}));
vi.mock("@/lib/telegram", () => ({
  kickChatMember: async () => { state.telegram.push("kick"); },
  unbanChatMember: async () => { state.telegram.push("unban"); },
  createChatInviteLink: async () => { state.telegram.push("invite"); return { invite_link: "https://t.me/+test" }; },
  revokeChatInviteLink: async () => { state.telegram.push("revoke"); },
  sendMessage: async (_id: string, text: string) => { state.messages.push(text); },
}));

import { extendTrialAction, kickMemberAction, markPaidAction, requestPaymentProofAction, resendInviteAction, resendRenewalRemindersAction } from "@/app/admin/actions";

function member(overrides: Partial<Member> = {}): Member {
  return {
    pageId: "page-1", telegramUserId: "1001", telegramUsername: "@member", email: "member@example.com",
    status: "active_paid", tags: [], exchangeRegistered: true, exchangeName: "MEXC", exchangeUid: "uid",
    invitationEmailSent: true, uidSubmittedAt: null, inviteLink: null, inviteExpiresAt: null,
    groupJoinedAt: "2026-04-01T00:00:00.000Z", reviewDueAt: "2026-05-08T00:00:00.000Z",
    paymentDeadlineAt: null, paymentUidLast4: "1234", paymentProofFileId: "proof", paymentProofSubmittedAt: null,
    paidAt: "2026-04-08T00:00:00.000Z", subscriptionMonths: 1, finalPnl: "", renewalStep: "payment_pending",
    renewalReminderSentAt: "2026-05-01T00:00:00.000Z", renewalReminder3DaySentAt: "2026-05-05T00:00:00.000Z",
    renewalReminderDueAt: "2026-05-08T00:00:00.000Z", lastBotCheckAt: null, lastBotMessage: "", kickReason: "",
    tradingView: "", discordId: "", discordVerifiedAt: null, discordRole: null, ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
  state.member = member(); state.telegram = []; state.messages = []; state.reminderStages = [];
});

afterEach(() => vi.useRealTimers());

describe("admin membership actions preserve Telegram access", () => {
  it("disables membership without kicking an existing Telegram member", async () => {
    await kickMemberAction("page-1");
    expect(state.member?.status).toBe("kicked");
    expect(state.member?.groupJoinedAt).toBe("2026-04-01T00:00:00.000Z");
    expect(state.telegram).toEqual([]);
  });

  it("reactivates a formerly kicked membership without a new Telegram invitation", async () => {
    state.member = member({ status: "expired", kickReason: "old_expiry", reviewDueAt: "2026-04-25T00:00:00.000Z" });
    await markPaidAction("page-1", 3);
    expect(state.member).toMatchObject({ status: "active_paid", reviewDueAt: "2026-08-01T00:00:00.000Z", subscriptionMonths: 3,
      paidAt: "2026-05-01T00:00:00.000Z", renewalStep: "", renewalReminderSentAt: null, renewalReminder3DaySentAt: null, renewalReminderDueAt: null });
    expect(state.telegram).toEqual([]);
  });

  it("extends an unexpired subscription from its existing due date only once on double submit", async () => {
    await markPaidAction("page-1", 1);
    await markPaidAction("page-1", 1);
    expect(state.member?.reviewDueAt).toBe("2026-06-08T00:00:00.000Z");
    expect(state.messages).toHaveLength(1);
  });

  it("requests new payment proof without erasing previous payment history", async () => {
    await requestPaymentProofAction("page-1");
    expect(state.member).toMatchObject({ status: "payment_pending", renewalStep: "payment_pending", paidAt: "2026-04-08T00:00:00.000Z" });
    expect(state.messages).toHaveLength(1);
  });

  it("preserves an incomplete current submission when manually reminding about missing proof", async () => {
    state.member = member({ status: "payment_pending", paymentProofFileId: "partial-proof", paymentUidLast4: "", paymentDeadlineAt: "2026-05-02T00:00:00.000Z" });
    await requestPaymentProofAction("page-1");
    expect(state.member).toMatchObject({ paymentProofFileId: "partial-proof", paymentUidLast4: "", paymentDeadlineAt: "2026-05-02T00:00:00.000Z" });
  });

  it("preserves a complete pending submission after the payment deadline while awaiting admin review", async () => {
    state.member = member({ status: "expired", reviewDueAt: "2026-04-25T00:00:00.000Z", paymentProofFileId: "submitted-proof", paymentUidLast4: "5678", paymentProofSubmittedAt: "2026-04-29T00:00:00.000Z", paymentDeadlineAt: "2026-04-30T00:00:00.000Z" });
    await requestPaymentProofAction("page-1");
    expect(state.member).toMatchObject({ status: "expired", renewalStep: "payment_pending", paymentProofFileId: "submitted-proof", paymentUidLast4: "5678", paymentProofSubmittedAt: "2026-04-29T00:00:00.000Z", paymentDeadlineAt: "2026-04-30T00:00:00.000Z", paidAt: "2026-04-08T00:00:00.000Z" });
  });

  it("does not reactivate an expired member while asking for proof", async () => {
    state.member = member({ status: "expired", reviewDueAt: "2026-04-25T00:00:00.000Z" });
    await requestPaymentProofAction("page-1");
    expect(state.member).toMatchObject({ status: "expired", renewalStep: "payment_pending", paidAt: "2026-04-08T00:00:00.000Z", reviewDueAt: "2026-04-25T00:00:00.000Z" });
    expect(state.messages).toHaveLength(1);
  });

  it("selects the three-day reminder for manual resend near expiry without changing membership", async () => {
    state.member = member({ reviewDueAt: "2026-05-03T00:00:00.000Z" });
    await resendRenewalRemindersAction();
    expect(state.reminderStages).toEqual(["3day"]);
    expect(state.member.status).toBe("active_paid");
  });

  it("starts a fresh reminder cycle when extending trial", async () => {
    state.member = member({ status: "trial_active" });
    await extendTrialAction("page-1");
    expect(state.member).toMatchObject({ status: "trial_active", reviewDueAt: "2026-06-08T00:00:00.000Z", renewalStep: "", renewalReminderSentAt: null, renewalReminder3DaySentAt: null, renewalReminderDueAt: null });
  });

  it.each(["expired", "active_paid", "VIP"] as const)("resending Telegram invitation preserves %s membership and term", async (status) => {
    state.member = member({ status });
    await resendInviteAction("page-1");
    expect(state.member).toMatchObject({ status, reviewDueAt: "2026-05-08T00:00:00.000Z", paidAt: "2026-04-08T00:00:00.000Z", inviteLink: "https://t.me/+test" });
  });

  it.each(["denied", "kicked"] as const)("rejects invitation resend for %s until membership is handled", async (status) => {
    state.member = member({ status });
    await expect(resendInviteAction("page-1")).rejects.toThrow();
    expect(state.telegram).toEqual([]);
  });
});
