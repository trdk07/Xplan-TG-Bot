import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  members: [] as any[],
  sent: [] as Array<{ chatId: string | number; text: string; keyboard?: any }>,
  edited: [] as Array<{
    chatId: string | number;
    messageId: number;
    text: string;
    keyboard?: any;
  }>,
  callbackAnswers: [] as Array<{
    id: string;
    text?: string;
    showAlert?: boolean;
  }>,
  updates: [] as Array<{ pageId: string; patch: any }>,
  kicked: [] as Array<string | number>,
  approved: [] as Array<string | number>,
  declined: [] as Array<string | number>,
  unbanned: [] as Array<string | number>,
  invites: [] as any[],
  mexcReferrals: new Map<string, any>(),
  mexcCalls: [] as string[],
}));

vi.mock("@/lib/config", () => ({
  getRuntimeConfig: () => ({
    telegramBotToken: "token",
    telegramWebhookSecret: "secret",
    telegramGroupId: "-100",
    notionApiKey: "notion",
    notionDataSourceId: "source",
    adminPassword: "pw",
    appBaseUrl: "https://app.test",
    exchangeName: "X-Plan",
    teacherTelegramUid: "1222518302",
    trialDays: 30,
    paymentGraceDays: 3,
    jobSecret: "job",
    mexcApiBaseUrl: "https://api.mexc.test",
    mexcApiAccessKey: "access",
    mexcApiSecretKey: "secret",
    mexcAffiliateEndpoint: "/api/v3/rebate/affiliate/referral",
    mexcAffiliateUidParam: "uid",
    mexcAffiliateMemberInfo: "",
    mexcAffiliateLookbackDays: 365,
    mexcMinDepositUsdt: 100,
  }),
}));

vi.mock("@/lib/notion", () => ({
  findMemberByTelegramId: vi.fn(async (telegramUserId: string) => {
    return (
      state.members.find(
        (member) => member.telegramUserId === telegramUserId,
      ) || null
    );
  }),
  findMemberByTelegramUsername: vi.fn(async (username: string | undefined) => {
    if (!username) return null;
    const normalized = `@${username.replace(/^@/, "")}`.toLowerCase();
    return (
      state.members.find(
        (member) => member.telegramUsername.toLowerCase() === normalized,
      ) || null
    );
  }),
  findMemberByExchangeUid: vi.fn(
    async (exchangeName: string, exchangeUid: string) => {
      return (
        state.members.find(
          (member) =>
            member.exchangeName.toLowerCase() === exchangeName.toLowerCase() &&
            member.exchangeUid.trim().toLowerCase() ===
              exchangeUid.trim().toLowerCase(),
        ) || null
      );
    },
  ),
  listMembers: vi.fn(async (options?: { limit?: number }) => options?.limit ? state.members.slice(0, options.limit) : state.members),
  normalizeExchangeUid: (value: string) => value.trim().toLowerCase(),
  updateMember: vi.fn(async (pageId: string, patch: any) => {
    state.updates.push({ pageId, patch });
    const member = state.members.find((item) => item.pageId === pageId);
    if (member) Object.assign(member, patch);
  }),
}));

vi.mock("@/lib/telegram", () => ({
  answerCallbackQuery: vi.fn(
    async (id: string, text?: string, showAlert?: boolean) => {
      state.callbackAnswers.push({ id, text, showAlert });
    },
  ),
  approveChatJoinRequest: vi.fn(async (id: string | number) => { state.approved.push(id); }),
  editMessageText: vi.fn(
    async (
      chatId: string | number,
      messageId: number,
      text: string,
      keyboard?: any,
    ) => {
      state.edited.push({ chatId, messageId, text, keyboard });
    },
  ),
  createChatInviteLink: vi.fn(async () => {
    state.invites.push(true);
    return { invite_link: "https://t.me/+invite" };
  }),
  declineChatJoinRequest: vi.fn(async (id: string | number) => { state.declined.push(id); }),
  kickChatMember: vi.fn(async (userId: string | number) => {
    state.kicked.push(userId);
  }),
  revokeChatInviteLink: vi.fn(async () => undefined),
  sendMessage: vi.fn(
    async (chatId: string | number, text: string, keyboard?: any) => {
      state.sent.push({ chatId, text, keyboard });
    },
  ),
  unbanChatMember: vi.fn(async (userId: string | number) => {
    state.unbanned.push(userId);
  }),
}));

vi.mock("@/lib/mexc", () => ({
  getMexcDirectSubaffiliate: vi.fn(async (uid: string) => {
    state.mexcCalls.push(uid);
    return state.mexcReferrals.get(uid) || null;
  }),
  mexcDepositMeetsMinimum: (referral: any, minimumUsdt: number) =>
    Number.parseFloat(referral.depositAmount || "0") >= minimumUsdt,
}));

import { sendMessage } from "@/lib/telegram";
import {
  exchanges,
  handleTelegramUpdate,
  runDailyMembershipJob,
} from "@/lib/bot";

function member(overrides: Record<string, any> = {}) {
  return {
    pageId: "page-1",
    telegramUserId: "1001",
    telegramUsername: "@user",
    status: "trial_active",
    tags: [],
    exchangeRegistered: true,
    exchangeName: "MEXC",
    exchangeUid: "UID-1",
    uidSubmittedAt: null,
    inviteLink: null,
    inviteExpiresAt: null,
    groupJoinedAt: null,
    reviewDueAt: "2026-05-08T00:00:00.000Z",
    paymentDeadlineAt: null,
    paymentUidLast4: "",
    paymentProofFileId: "",
    paymentProofSubmittedAt: null,
    paidAt: null,
    finalPnl: "",
    renewalStep: "",
    renewalReminderSentAt: null,
    renewalReminder3DaySentAt: null,
    renewalReminderDueAt: null,
    lastBotCheckAt: null,
    lastBotMessage: "",
    kickReason: "",
    tradingView: "",
    tradingViewAccess: "",
    ...overrides,
  };
}

describe("renewal bot flow", () => {
  beforeEach(() => {
    state.members = [];
    state.sent = [];
    state.edited = [];
    state.callbackAnswers = [];
    state.updates = [];
    state.kicked = [];
    state.approved = [];
    state.declined = [];
    state.unbanned = [];
    state.invites = [];
    state.mexcReferrals = new Map();
    state.mexcCalls = [];
  });

  it("uses the updated BitMart registration link", () => {
    expect(exchanges.BitMart.url).toBe(
      "https://www.bitmart.com/zh-TW/invite/cMPDb9",
    );
  });

  async function click(data: string, now: Date, withMessage = false) {
    await handleTelegramUpdate({
      update_id: 100,
      callback_query: {
        id: "cb-test", from: { id: 1001 }, data,
        ...(withMessage ? { message: { message_id: 99, chat: { id: 1001, type: "private" }, text: "會籍到期提醒" } } : {}),
      },
    }, now);
  }

  it.each(["trial_active", "active_paid"])("sends the seven-day expiry notice once without changing %s or asking survey questions", async (status) => {
    state.members = [member({ status })];
    const now = new Date("2026-05-01T00:00:00.000Z");
    await runDailyMembershipJob(now);
    await runDailyMembershipJob(now);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].text).toContain("7 天內到期");
    expect(state.sent[0].text).toContain("2026年5月8日");
    expect(state.sent[0].text).toContain("Telegram 群組");
    expect(state.sent[0].text).not.toContain("翻倉");
    expect(state.sent[0].keyboard.flat().every((button: any) => !button.callback_data?.startsWith("trial_result:"))).toBe(true);
    expect(state.members[0]).toMatchObject({
      status, renewalStep: "", renewalReminderSentAt: now.toISOString(),
      renewalReminderDueAt: "2026-05-08T00:00:00.000Z",
    });
  });

  it("sends a separate three-day notice after entering payment_pending, once per period", async () => {
    state.members = [member()];
    await runDailyMembershipJob(new Date("2026-05-01T00:00:00.000Z"));
    await click("renewal:stay", new Date("2026-05-02T00:00:00.000Z"));
    expect(state.members[0].status).toBe("payment_pending");
    state.sent = [];
    const now = new Date("2026-05-05T00:00:00.000Z");
    await runDailyMembershipJob(now);
    await runDailyMembershipJob(now);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].text).toContain("3 天內到期");
    expect(state.members[0]).toMatchObject({
      status: "payment_pending", renewalReminderSentAt: "2026-05-01T00:00:00.000Z",
      renewalReminder3DaySentAt: now.toISOString(),
    });
  });

  it("sends only the three-day notice when first observed in that window", async () => {
    state.members = [member()];
    await runDailyMembershipJob(new Date("2026-05-06T00:00:00.000Z"));
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].text).toContain("3 天內到期");
    expect(state.members[0].renewalReminderSentAt).toBeNull();
  });

  it("starts a new reminder period when the Notion expiry date changes", async () => {
    state.members = [member({
      reviewDueAt: "2026-06-08T00:00:00.000Z",
      renewalReminderDueAt: "2026-05-08T00:00:00.000Z",
      renewalReminderSentAt: "2026-05-01T00:00:00.000Z",
      renewalReminder3DaySentAt: "2026-05-05T00:00:00.000Z",
    })];
    await runDailyMembershipJob(new Date("2026-06-01T00:00:00.000Z"));
    expect(state.sent).toHaveLength(1);
    expect(state.members[0]).toMatchObject({
      renewalReminderDueAt: "2026-06-08T00:00:00.000Z",
      renewalReminderSentAt: "2026-06-01T00:00:00.000Z",
      renewalReminder3DaySentAt: null,
    });
  });

  it("does not mark a failed reminder sent and continues with other members", async () => {
    state.members = [member({ pageId: "fail", telegramUserId: "2002" }), member()];
    vi.mocked(sendMessage).mockImplementationOnce(async () => { throw new Error("telegram boom"); });
    const results = await runDailyMembershipJob(new Date("2026-05-01T00:00:00.000Z"));
    expect(results.find((r) => r.pageId === "fail")?.action).toBe("error");
    expect(state.members[0].renewalReminderSentAt).toBeNull();
    expect(state.members[1].renewalReminderSentAt).toBe("2026-05-01T00:00:00.000Z");
    expect(state.sent.some((s) => s.chatId === "1222518302" && s.text.includes("失敗 1"))).toBe(true);
  });

  it.each(["trial_active", "active_paid", "payment_pending"])("expires %s once in Notion without removing Telegram access", async (status) => {
    state.members = [member({ status, paymentDeadlineAt: "2026-05-10T00:00:00.000Z", renewalStep: status === "payment_pending" ? "payment_pending" : "" })];
    const now = new Date("2026-05-08T00:00:00.000Z");
    await runDailyMembershipJob(now);
    await runDailyMembershipJob(now);
    expect(state.members[0].status).toBe("expired");
    expect(state.kicked).toEqual([]);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].text).toContain("Telegram 群組");
    expect(state.sent[0].text).not.toContain("自動將你移出");
    expect(state.updates.filter((u) => u.patch.status === "expired")).toHaveLength(1);
  });

  it("updates expiry even without Telegram ID and never sends to an empty ID", async () => {
    state.members = [member({ telegramUserId: "" })];
    await runDailyMembershipJob(new Date("2026-05-01T00:00:00.000Z"));
    expect(state.sent).toEqual([]);
    await runDailyMembershipJob(new Date("2026-05-08T00:00:00.000Z"));
    await runDailyMembershipJob(new Date("2026-05-09T00:00:00.000Z"));
    expect(state.members[0].status).toBe("expired");
    expect(state.updates.filter((u) => u.patch.status === "expired")).toHaveLength(1);
    expect(state.sent).toEqual([]);
    expect(state.kicked).toEqual([]);
  });

  it.each(["partner", "exempt", "VIP"])("does not expire or remind non-expiring %s members", async (status) => {
    state.members = [member({ status })];
    await runDailyMembershipJob(new Date("2026-05-01T00:00:00.000Z"));
    await runDailyMembershipJob(new Date("2026-06-01T00:00:00.000Z"));
    expect(state.members[0].status).toBe(status);
    expect(state.sent).toEqual([]);
    expect(state.kicked).toEqual([]);
  });

  it.each(["trial_result:success", "trial_result:not_yet"])("rejects retired questionnaire action %s without recording answers", async (data) => {
    state.members = [member({ status: "sent_7day_survey", renewalStep: "awaiting_trial_result" })];
    await click(data, new Date("2026-05-01T00:00:00.000Z"));
    expect(state.members[0].tags).not.toContain("翻倉成功");
    expect(state.members[0].renewalStep).not.toBe("awaiting_pnl");
    expect(state.sent.at(-1)?.text).toContain("這個按鈕已不是目前可操作的步驟");
  });

  it("does not collect P/L from a retired questionnaire conversation", async () => {
    state.members = [member({ status: "sent_7day_survey", renewalStep: "awaiting_pnl", groupJoinedAt: "2026-04-08T00:00:00.000Z" })];
    await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, from: { id: 1001 }, chat: { id: 1001, type: "private" }, text: "+25%" } }, new Date("2026-05-01T00:00:00.000Z"));
    expect(state.members[0].finalPnl).toBe("");
    expect(state.invites).toEqual([]);
  });

  it("rejects a previous-period reminder button after membership was extended", async () => {
    state.members = [member()];
    await runDailyMembershipJob(new Date("2026-05-01T00:00:00.000Z"));
    const oldAction = state.sent[0].keyboard[0][0].callback_data;
    await click(oldAction, new Date("2026-05-02T00:00:00.000Z"));
    expect(state.members[0].status).toBe("payment_pending");
    state.members[0].renewalStep = "";
    state.members[0].reviewDueAt = "2026-06-08T00:00:00.000Z";
    state.members[0].status = "active_paid";
    await click(oldAction, new Date("2026-06-01T00:00:00.000Z"));
    expect(state.members[0].status).toBe("active_paid");
    expect(state.members[0].renewalStep).toBe("");
    expect(state.sent.at(-1)?.text).toContain("這個按鈕已不是目前可操作的步驟");
  });

  it("starts manual payment directly from an active membership and preserves payment history", async () => {
    state.members = [member({ status: "active_paid", paidAt: "2026-04-08T00:00:00.000Z" })];
    const now = new Date("2026-05-02T00:00:00.000Z");
    await click("renewal:stay", now, true);
    expect(state.members[0]).toMatchObject({ status: "payment_pending", renewalStep: "payment_pending", paidAt: "2026-04-08T00:00:00.000Z", paymentDeadlineAt: "2026-05-08T00:00:00.000Z" });
    expect(state.sent.some((s) => s.text.includes("MEXC - UID：77242747"))).toBe(true);
    expect(state.edited.at(-1)?.text).toContain("✅ 你已選擇：繼續訂閱");
    await handleTelegramUpdate({ update_id: 2, message: { message_id: 2, from: { id: 1001 }, chat: { id: 1001, type: "private" }, caption: "UID 末四碼 1234", photo: [{ file_id: "proof", width: 500, height: 500 }] } }, now);
    expect(state.members[0]).toMatchObject({ paymentUidLast4: "1234", paymentProofFileId: "proof", paymentProofSubmittedAt: now.toISOString() });
  });

  it("records declined renewal without changing active membership status", async () => {
    state.members = [member()];
    await click("renewal:leave", new Date("2026-05-01T00:00:00.000Z"));
    expect(state.members[0]).toMatchObject({ status: "trial_active", renewalStep: "declined" });
    expect(state.kicked).toEqual([]);
    expect(state.sent.at(-1)?.text).toContain("Telegram 群組");
  });

  it("closes late payment proof without expiring a still-valid membership or kicking", async () => {
    state.members = [member({ status: "payment_pending", renewalStep: "payment_pending", paymentDeadlineAt: "2026-05-04T00:00:00.000Z" })];
    await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, from: { id: 1001 }, chat: { id: 1001, type: "private" }, caption: "UID 末四碼 1234", photo: [{ file_id: "late", width: 500, height: 500 }] } }, new Date("2026-05-04T00:00:00.000Z"));
    expect(state.members[0]).toMatchObject({ status: "payment_pending", renewalStep: "payment_expired", paymentProofFileId: "", reviewDueAt: "2026-05-08T00:00:00.000Z" });
    expect(state.kicked).toEqual([]);
    expect(state.sent.at(-1)?.text).toContain("付款回覆期限已過");
  });

  it("daily payment expiry never removes a still-valid member, including complete proof", async () => {
    state.members = [member({ status: "payment_pending", renewalStep: "payment_pending", paymentDeadlineAt: "2026-05-04T00:00:00.000Z", paymentProofFileId: "proof", paymentUidLast4: "1234" })];
    await runDailyMembershipJob(new Date("2026-05-04T00:00:00.000Z"));
    expect(state.members[0].status).toBe("payment_pending");
    expect(state.members[0].paymentProofFileId).toBe("proof");
    expect(state.kicked).toEqual([]);
  });

  it.each([null, "2026-05-03T00:00:00.000Z"])("keeps complete submitted proof in review after deadline and membership expiry (%s)", async (submittedAt) => {
    state.members = [member({ status: "payment_pending", renewalStep: "payment_pending", paymentDeadlineAt: "2026-05-04T00:00:00.000Z", paymentProofFileId: "submitted-proof", paymentUidLast4: "1234", paymentProofSubmittedAt: submittedAt })];
    await runDailyMembershipJob(new Date("2026-05-04T00:00:00.000Z"));
    expect(state.members[0].renewalStep).toBe("payment_pending");
    await runDailyMembershipJob(new Date("2026-05-08T00:00:00.000Z"));
    await runDailyMembershipJob(new Date("2026-05-09T00:00:00.000Z"));
    expect(state.members[0]).toMatchObject({ status: "expired", renewalStep: "payment_pending", paymentProofFileId: "submitted-proof", paymentUidLast4: "1234" });
    expect(state.kicked).toEqual([]);
  });

  it.each(["payment_proof:start", "renewal:stay", `renewal:leave:${Date.parse("2026-05-08T00:00:00.000Z")}`, "rejoin_apply"])("keeps submitted proof awaiting review when %s is clicked after its deadline", async (action) => {
    state.members = [member({ status: action === "rejoin_apply" ? "expired" : "payment_pending", renewalStep: "payment_pending", paymentDeadlineAt: "2026-05-04T00:00:00.000Z", paymentProofFileId: "submitted-proof", paymentUidLast4: "1234", paymentProofSubmittedAt: "2026-05-03T00:00:00.000Z" })];
    await click(action, new Date("2026-05-05T00:00:00.000Z"));
    expect(state.members[0]).toMatchObject({ status: action === "rejoin_apply" ? "expired" : "payment_pending", renewalStep: "payment_pending", paymentDeadlineAt: "2026-05-04T00:00:00.000Z", paymentProofFileId: "submitted-proof", paymentProofSubmittedAt: "2026-05-03T00:00:00.000Z" });
    expect(state.sent.at(-1)?.text).toContain("等待助理審核");
    expect(state.invites).toEqual([]);
  });

  it("does not discard complete on-time proof when another upload arrives after deadline", async () => {
    state.members = [member({ status: "payment_pending", renewalStep: "payment_pending", paymentDeadlineAt: "2026-05-04T00:00:00.000Z", paymentProofFileId: "submitted-proof", paymentUidLast4: "1234", paymentProofSubmittedAt: "2026-05-03T00:00:00.000Z" })];
    await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, from: { id: 1001 }, chat: { id: 1001, type: "private" }, caption: "UID 末四碼 5678", photo: [{ file_id: "late-proof", width: 500, height: 500 }] } }, new Date("2026-05-05T00:00:00.000Z"));
    expect(state.members[0]).toMatchObject({ renewalStep: "payment_pending", paymentProofFileId: "submitted-proof", paymentUidLast4: "1234" });
    expect(state.sent.at(-1)?.text).toContain("等待助理審核");
  });

  it("processes expiring members beyond the first 500 records", async () => {
    state.members = [...Array.from({ length: 500 }, (_, i) => member({ pageId: `exempt-${i}`, status: "exempt" })), member({ pageId: "page-501", telegramUserId: "1501" })];
    await runDailyMembershipJob(new Date("2026-05-08T00:00:00.000Z"));
    expect(state.members[500].status).toBe("expired");
    expect(state.sent.some((message) => message.chatId === "1501")).toBe(true);
    expect(state.kicked).toEqual([]);
  });

  it("offers self-service renewal when /start observes expiry before the daily job", async () => {
    const now = new Date("2026-05-08T00:00:00.000Z");
    state.members = [member({ groupJoinedAt: "2026-04-08T00:00:00.000Z" })];
    await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, from: { id: 1001 }, chat: { id: 1001, type: "private" }, text: "/start" } }, now);
    expect(state.members[0].status).toBe("expired");
    expect(state.sent.at(-1)?.keyboard?.[0]?.[0]?.callback_data).toBe("rejoin_apply");
    expect(state.sent.at(-1)?.text).toContain("Telegram 群組仍會保留");
    await runDailyMembershipJob(now);
    expect(state.sent).toHaveLength(1);
    expect(state.invites).toEqual([]);
    expect(state.kicked).toEqual([]);
  });

  it.each(["partner", "exempt", "VIP"])("keeps non-expiring %s status when its payment request times out", async (status) => {
    const now = new Date("2026-05-05T00:00:00.000Z");
    const pending = () => member({ status, reviewDueAt: "2026-05-01T00:00:00.000Z", renewalStep: "payment_pending", paymentDeadlineAt: "2026-05-04T00:00:00.000Z" });
    state.members = [pending()];
    await click("payment_proof:start", now);
    expect(state.members[0].status).toBe(status);
    state.members = [pending()];
    await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, from: { id: 1001 }, chat: { id: 1001, type: "private" }, text: "1234" } }, now);
    expect(state.members[0].status).toBe(status);
    expect(state.kicked).toEqual([]);
  });

  it("preserves a dated pending invite's existing expiry even when no join history is recorded", async () => {
    const now = new Date("2026-05-02T00:00:00.000Z");
    state.members = [member({ status: "join_pending", reviewDueAt: "2026-05-03T00:00:00.000Z", groupJoinedAt: null, paidAt: null, inviteLink: "https://t.me/+invite", inviteExpiresAt: "2026-05-03T00:00:00.000Z" })];
    await handleTelegramUpdate({ update_id: 2, chat_join_request: { chat: { id: -100 }, from: { id: 1001 }, user_chat_id: 1001, date: Math.floor(now.getTime() / 1000), invite_link: { invite_link: "https://t.me/+invite" } } }, now);
    expect(state.approved).toEqual([1001]);
    expect(state.members[0].reviewDueAt).toBe("2026-05-03T00:00:00.000Z");
    expect(state.kicked).toEqual([]);
  });

  it("overdue payment button preserves valid membership and never kicks", async () => {
    state.members = [member({ status: "payment_pending", renewalStep: "payment_pending", paymentDeadlineAt: "2026-05-04T00:00:00.000Z" })];
    await click("payment_proof:start", new Date("2026-05-04T00:00:00.000Z"));
    expect(state.members[0].status).toBe("payment_pending");
    expect(state.kicked).toEqual([]);
  });

  it("expired members can submit a new payment application without an invite or new trial", async () => {
    state.members = [member({ status: "expired", groupJoinedAt: "2026-04-08T00:00:00.000Z", reviewDueAt: "2026-05-01T00:00:00.000Z" })];
    await click("rejoin_apply", new Date("2026-05-04T00:00:00.000Z"));
    expect(state.members[0]).toMatchObject({ status: "expired", renewalStep: "payment_pending", paymentDeadlineAt: "2026-05-07T00:00:00.000Z", reviewDueAt: "2026-05-01T00:00:00.000Z" });
    expect(state.invites).toEqual([]);
    expect(state.kicked).toEqual([]);
  });

  it.each(["expired", "kicked", "denied", "eligible"])("never removes an existing Telegram member observed with %s status", async (status) => {
    state.members = [member({ status })];
    const now = new Date("2026-05-10T00:00:00.000Z");
    await handleTelegramUpdate({ update_id: 3, chat_member: { chat: { id: -100 }, from: { id: 1001 }, date: Math.floor(now.getTime() / 1000), old_chat_member: { status: "left", user: { id: 1001 } }, new_chat_member: { status: "member", user: { id: 1001 } } } }, now);
    expect(state.kicked).toEqual([]);
    expect(state.members[0].status).toBe(status);
  });

  it("never removes an unknown user already observed inside the Telegram group", async () => {
    const now = new Date("2026-05-10T00:00:00.000Z");
    await handleTelegramUpdate({ update_id: 3, chat_member: { chat: { id: -100 }, from: { id: 2002 }, date: Math.floor(now.getTime() / 1000), old_chat_member: { status: "left", user: { id: 2002 } }, new_chat_member: { status: "member", user: { id: 2002 } } } }, now);
    expect(state.kicked).toEqual([]);
  });

  it("does not award a fresh trial when an expired former member uses an old pending invite", async () => {
    const now = new Date("2026-05-10T00:00:00.000Z");
    state.members = [member({ status: "join_pending", groupJoinedAt: "2026-04-08T00:00:00.000Z", reviewDueAt: "2026-05-08T00:00:00.000Z", inviteLink: "https://t.me/+old", inviteExpiresAt: "2026-05-11T00:00:00.000Z" })];
    await handleTelegramUpdate({ update_id: 4, chat_join_request: { chat: { id: -100 }, from: { id: 1001 }, user_chat_id: 1001, date: Math.floor(now.getTime() / 1000), invite_link: { invite_link: "https://t.me/+old" } } }, now);
    expect(state.approved).toEqual([]);
    expect(state.declined).toEqual([1001]);
    expect(state.members[0].reviewDueAt).toBe("2026-05-08T00:00:00.000Z");
    expect(state.kicked).toEqual([]);
  });

  it.each(["trial_active", "active_paid"])("preserves a valid %s period when issuing and accepting a re-entry invite", async (status) => {
    const now = new Date("2026-05-02T00:00:00.000Z");
    state.members = [member({ status, groupJoinedAt: null, renewalReminderDueAt: "2026-05-08T00:00:00.000Z", renewalReminderSentAt: "2026-05-01T00:00:00.000Z" })];
    await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, from: { id: 1001 }, chat: { id: 1001, type: "private" }, text: "/start" } }, now);
    expect(state.members[0].status).toBe(status);
    await handleTelegramUpdate({ update_id: 2, chat_join_request: { chat: { id: -100 }, from: { id: 1001 }, user_chat_id: 1001, date: Math.floor(now.getTime() / 1000), invite_link: { invite_link: "https://t.me/+invite" } } }, now);
    expect(state.approved).toEqual([1001]);
    expect(state.members[0]).toMatchObject({ status, reviewDueAt: "2026-05-08T00:00:00.000Z", renewalReminderSentAt: "2026-05-01T00:00:00.000Z" });
  });

  it("accepts a fresh verified invite and starts the first trial exactly once", async () => {
    const now = new Date("2026-05-02T00:00:00.000Z");
    state.members = [member({ status: "join_pending", reviewDueAt: null, groupJoinedAt: null, inviteLink: "https://t.me/+invite", inviteExpiresAt: "2026-05-03T00:00:00.000Z" })];
    const update = { update_id: 2, chat_join_request: { chat: { id: -100 }, from: { id: 1001 }, user_chat_id: 1001, date: Math.floor(now.getTime() / 1000), invite_link: { invite_link: "https://t.me/+invite" } } };
    await handleTelegramUpdate(update, now);
    await handleTelegramUpdate(update, now);
    expect(state.approved).toEqual([1001]);
    expect(state.members[0]).toMatchObject({ status: "trial_active", groupJoinedAt: "2026-05-02T00:00:00.000Z", reviewDueAt: "2026-06-01T00:00:00.000Z", inviteLink: null, renewalReminder3DaySentAt: null });
  });

  it("starts a first trial without writing unavailable reminder columns", async () => {
    const now = new Date("2026-05-02T00:00:00.000Z");
    state.members = [member({ status: "join_pending", reviewDueAt: null, reminderFieldsAvailable: false, inviteLink: "https://t.me/+invite", inviteExpiresAt: "2026-05-03T00:00:00.000Z" })];
    await handleTelegramUpdate({ update_id: 2, chat_join_request: { chat: { id: -100 }, from: { id: 1001 }, user_chat_id: 1001, date: Math.floor(now.getTime() / 1000), invite_link: { invite_link: "https://t.me/+invite" } } }, now);
    expect(state.approved).toEqual([1001]);
    const trialWrite = state.updates.find((update) => update.patch.status === "trial_active")!.patch;
    expect(trialWrite.reviewDueAt).toBe("2026-06-01T00:00:00.000Z");
    expect(trialWrite).not.toHaveProperty("renewalReminder3DaySentAt");
    expect(trialWrite).not.toHaveProperty("renewalReminderDueAt");
  });

  it("preserves seven-day evidence when equivalent Notion date formats describe the same period", async () => {
    state.members = [member({ renewalReminderDueAt: "2026-05-08T00:00:00+00:00", renewalReminderSentAt: "2026-05-01T00:00:00.000Z" })];
    await runDailyMembershipJob(new Date("2026-05-05T00:00:00.000Z"));
    expect(state.members[0].renewalReminderSentAt).toBe("2026-05-01T00:00:00.000Z");
    expect(state.members[0].renewalReminder3DaySentAt).toBe("2026-05-05T00:00:00.000Z");
  });

  it("does not repeat a legacy seven-day notice after safe trial normalization", async () => {
    state.members = [member({ status: "sent_7day_survey", groupJoinedAt: "2026-04-08T00:00:00.000Z", renewalStep: "awaiting_pnl", lastBotCheckAt: "2026-05-01T00:00:00.000Z" })];
    await runDailyMembershipJob(new Date("2026-05-02T00:00:00.000Z"));
    expect(state.members[0]).toMatchObject({ status: "trial_active", renewalStep: "", renewalReminderSentAt: "2026-05-01T00:00:00.000Z" });
    expect(state.sent).toEqual([]);
    await runDailyMembershipJob(new Date("2026-05-05T00:00:00.000Z"));
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].text).toContain("3 天內到期");
  });

  it("sends the three-day notice for an ambiguous paid legacy period without guessing its tier or repeating seven-day notice", async () => {
    state.members = [member({ status: "sent_7day_survey", groupJoinedAt: "2026-04-08T00:00:00.000Z", paidAt: "2026-05-01T00:00:00.000Z", subscriptionMonths: 1, reviewDueAt: "2026-06-08T00:00:00.000Z", lastBotCheckAt: "2026-06-01T00:00:00.000Z" })];
    await runDailyMembershipJob(new Date("2026-06-01T00:00:00.000Z"));
    expect(state.sent).toEqual([]);
    await runDailyMembershipJob(new Date("2026-06-05T00:00:00.000Z"));
    await runDailyMembershipJob(new Date("2026-06-05T00:00:00.000Z"));
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].text).toContain("3 天內到期");
    expect(state.members[0]).toMatchObject({ status: "sent_7day_survey", renewalReminderSentAt: "2026-06-01T00:00:00.000Z", renewalReminder3DaySentAt: "2026-06-05T00:00:00.000Z", renewalReminderDueAt: "2026-06-08T00:00:00.000Z" });
  });

  it("blocks reminders when Notion lacks reminder fields while still expiring memberships", async () => {
    state.members = [member({ reminderFieldsAvailable: false })];
    const result = await runDailyMembershipJob(new Date("2026-05-01T00:00:00.000Z"));
    expect(result[0].action).toBe("error");
    expect(state.sent.every((message) => message.chatId !== "1001")).toBe(true);
    state.sent = [];
    await runDailyMembershipJob(new Date("2026-05-08T00:00:00.000Z"));
    expect(state.members[0].status).toBe("expired");
    expect(state.kicked).toEqual([]);
  });

  it("accepts proof for an expired member's open renewal without restoring membership", async () => {
    const now = new Date("2026-05-04T00:00:00.000Z");
    state.members = [member({ status: "expired", reviewDueAt: "2026-05-01T00:00:00.000Z", renewalStep: "payment_pending", paymentDeadlineAt: "2026-05-07T00:00:00.000Z" })];
    await handleTelegramUpdate({ update_id: 1, message: { message_id: 1, from: { id: 1001 }, chat: { id: 1001, type: "private" }, caption: "UID 末四碼 1234", photo: [{ file_id: "proof", width: 500, height: 500 }] } }, now);
    expect(state.members[0]).toMatchObject({ status: "expired", paymentProofFileId: "proof", paymentUidLast4: "1234" });
    expect(state.invites).toEqual([]);
    expect(state.kicked).toEqual([]);
  });

  it("asks an eligible member for MEXC UID before sending an invite", async () => {
    state.members = [
      member({
        pageId: "page-1",
        telegramUserId: "1001",
        status: "eligible",
        exchangeUid: "",
      }),
    ];

    await handleTelegramUpdate({
      update_id: 4,
      message: {
        message_id: 1,
        from: { id: 1001, username: "user" },
        chat: { id: 1001, type: "private" },
        text: "/start",
      },
    });

    expect(state.invites).toHaveLength(0);
    expect(state.unbanned).toHaveLength(0);
    expect(state.mexcCalls).toHaveLength(0);
    expect(state.members[0]).toMatchObject({
      status: "collecting_info",
      telegramUsername: "@user",
    });
    expect(state.sent[0].text).toContain("請回覆你的 MEXC UID");
  });

  it("asks an old join-pending member without MEXC UID to verify before resending an invite", async () => {
    state.members = [
      member({
        pageId: "page-1",
        telegramUserId: "1001",
        status: "join_pending",
        exchangeRegistered: false,
        exchangeUid: "",
        inviteLink: null,
        inviteExpiresAt: null,
      }),
    ];

    await handleTelegramUpdate({
      update_id: 45,
      message: {
        message_id: 1,
        from: { id: 1001, username: "user" },
        chat: { id: 1001, type: "private" },
        text: "/start",
      },
    });

    expect(state.invites).toHaveLength(0);
    expect(state.mexcCalls).toHaveLength(0);
    expect(state.members[0]).toMatchObject({
      status: "collecting_info",
    });
    expect(state.sent[0].text).toContain("請回覆你的 MEXC UID");
  });

  it("verifies MEXC UID and deposit then sends invite", async () => {
    state.members = [
      member({
        pageId: "page-1",
        telegramUserId: "1001",
        status: "collecting_info",
        exchangeUid: "",
      }),
    ];
    state.mexcReferrals.set("987654321", { uid: "987654321", depositAmount: "250", raw: {} });
    const now = new Date("2026-05-01T00:00:00.000Z");

    await handleTelegramUpdate(
      {
        update_id: 46,
        message: {
          message_id: 1,
          from: { id: 1001, username: "user" },
          chat: { id: 1001, type: "private" },
          text: "987654321",
        },
      },
      now,
    );

    expect(state.mexcCalls).toEqual(["987654321"]);
    expect(state.invites).toHaveLength(1);
    expect(state.unbanned).toEqual(["1001"]);
    expect(state.members[0]).toMatchObject({
      status: "join_pending",
      exchangeRegistered: true,
      exchangeName: "Mexc（抹茶）",
      exchangeUid: "987654321",
      uidSubmittedAt: now.toISOString(),
      telegramUsername: "@user",
    });
    expect(state.sent.at(-1)?.text).toContain("專屬短效入群連結");
  });

  it("refuses invite when submitted MEXC UID does not match Notion UID", async () => {
    state.members = [
      member({
        pageId: "page-1",
        telegramUserId: "1001",
        status: "collecting_info",
        exchangeRegistered: false, // not yet verified — UID collection still required
        exchangeUid: "111111111",
      }),
    ];

    await handleTelegramUpdate({
      update_id: 49,
      message: {
        message_id: 1,
        from: { id: 1001, username: "user" },
        chat: { id: 1001, type: "private" },
        text: "222222222",
      },
    });

    expect(state.mexcCalls).toHaveLength(0);
    expect(state.invites).toHaveLength(0);
    expect(state.sent.at(-1)?.text).toContain("與系統紀錄的 MEXC UID 不一致");
    expect(state.sent.at(-1)?.text).toContain("聯絡小夏");
  });

  it("rejects invite when submitted UID has no digits", async () => {
    state.members = [
      member({
        pageId: "page-1",
        telegramUserId: "1001",
        status: "collecting_info",
        exchangeUid: "",
      }),
    ];

    await handleTelegramUpdate({
      update_id: 47,
      message: {
        message_id: 1,
        from: { id: 1001, username: "user" },
        chat: { id: 1001, type: "private" },
        text: "hello",
      },
    });

    expect(state.mexcCalls).toHaveLength(0);
    expect(state.invites).toHaveLength(0);
    expect(state.sent.at(-1)?.text).toContain("沒有 UID");
  });

  it("refuses invite when MEXC UID not found in affiliate list", async () => {
    state.members = [
      member({
        pageId: "page-1",
        telegramUserId: "1001",
        status: "collecting_info",
        exchangeUid: "",
      }),
    ];
    // no entry in mexcReferrals → API returns null

    await handleTelegramUpdate({
      update_id: 48,
      message: {
        message_id: 1,
        from: { id: 1001, username: "user" },
        chat: { id: 1001, type: "private" },
        text: "12345678",
      },
    });

    expect(state.mexcCalls).toEqual(["12345678"]);
    expect(state.invites).toHaveLength(0);
    expect(state.sent.at(-1)?.text).toContain("查無此 MEXC UID");
  });

  it("refuses invite when MEXC deposit below minimum", async () => {
    state.members = [
      member({
        pageId: "page-1",
        telegramUserId: "1001",
        status: "collecting_info",
        exchangeUid: "",
      }),
    ];
    state.mexcReferrals.set("99999999", { uid: "99999999", depositAmount: "50", raw: {} });

    await handleTelegramUpdate({
      update_id: 50,
      message: {
        message_id: 1,
        from: { id: 1001, username: "user" },
        chat: { id: 1001, type: "private" },
        text: "99999999",
      },
    });

    expect(state.mexcCalls).toEqual(["99999999"]);
    expect(state.invites).toHaveLength(0);
    expect(state.sent.at(-1)?.text).toContain("入金金額未達");
  });

  it.each([
    ["expired", "已到期"],
    ["kicked", "已停用"],
    ["denied", "拒絕加入"],
  ])(
    "does not send an invite to a %s member found by Telegram user id",
    async (status, label) => {
      state.members = [
        member({
          pageId: "page-1",
          telegramUserId: "1001",
          status,
          kickReason: "payment_deadline_missed",
        }),
      ];

      await handleTelegramUpdate({
        update_id: 44,
        message: {
          message_id: 1,
          from: { id: 1001, username: "user" },
          chat: { id: 1001, type: "private" },
          text: "/start",
        },
      });

      expect(state.invites).toHaveLength(0);
      expect(state.unbanned).toHaveLength(0);
      expect(state.members[0].status).toBe(status);
      if (status !== "expired") expect(state.sent[0].text).toContain("目前無法提供入群連結");
      expect(state.sent[0].text).toContain(label);
    },
  );

  it("does not send an invite to a kicked member found by Telegram username", async () => {
    state.members = [
      member({
        pageId: "page-1",
        telegramUserId: "",
        telegramUsername: "@user",
        status: "kicked",
        kickReason: "payment_deadline_missed",
      }),
    ];

    await handleTelegramUpdate({
      update_id: 45,
      message: {
        message_id: 1,
        from: { id: 1001, username: "user" },
        chat: { id: 1001, type: "private" },
        text: "/start",
      },
    });

    expect(state.invites).toHaveLength(0);
    expect(state.unbanned).toHaveLength(0);
    expect(state.members[0]).toMatchObject({
      telegramUserId: "1001",
      status: "kicked",
    });
    expect(state.sent[0].text).toContain("目前無法提供入群連結");
    expect(state.sent[0].text).toContain("已停用");
  });

  it("reuses an unexpired pending invite on start", async () => {
    state.members = [
      member({
        pageId: "page-1",
        telegramUserId: "1001",
        status: "join_pending",
        inviteLink: "https://t.me/+old",
        inviteExpiresAt: "2026-05-02T00:00:00.000Z",
      }),
    ];

    await handleTelegramUpdate(
      {
        update_id: 5,
        message: {
          message_id: 1,
          from: { id: 1001, username: "user" },
          chat: { id: 1001, type: "private" },
          text: "/start",
        },
      },
      new Date("2026-05-01T00:00:00.000Z"),
    );

    expect(state.invites).toHaveLength(0);
    expect(state.unbanned).toHaveLength(0);
    expect(state.sent[0].text).toContain("https://t.me/+old");
  });

  it("accepts image document as payment proof when member is payment_pending", async () => {
    state.members = [
      member({
        status: "payment_pending",
        renewalStep: "payment_pending",
        paymentDeadlineAt: "2026-05-04T00:00:00.000Z",
      }),
    ];
    const now = new Date("2026-05-02T00:00:00.000Z");

    await handleTelegramUpdate(
      {
        update_id: 40,
        message: {
          message_id: 10,
          from: { id: 1001, username: "user" },
          chat: { id: 1001, type: "private" },
          caption: "UID 末四碼 5678",
          document: {
            file_id: "doc-file-id",
            mime_type: "image/png",
          },
        },
      },
      now,
    );

    expect(state.members[0]).toMatchObject({
      paymentUidLast4: "5678",
      paymentProofFileId: "doc-file-id",
      paymentProofSubmittedAt: now.toISOString(),
    });
    expect(state.sent.at(-1)?.text).toContain("已收到你的轉帳截圖與 UID 末四碼");
  });

  it("does not accept non-image document as payment proof", async () => {
    state.members = [
      member({
        status: "payment_pending",
        renewalStep: "payment_pending",
        paymentDeadlineAt: "2026-05-04T00:00:00.000Z",
      }),
    ];
    const now = new Date("2026-05-02T00:00:00.000Z");

    await handleTelegramUpdate(
      {
        update_id: 41,
        message: {
          message_id: 11,
          from: { id: 1001, username: "user" },
          chat: { id: 1001, type: "private" },
          caption: "UID 末四碼 5678",
          document: {
            file_id: "pdf-file-id",
            mime_type: "application/pdf",
          },
        },
      },
      now,
    );

    expect(state.members[0].paymentProofFileId).toBe("");
    expect(state.members[0].paymentUidLast4).toBe("5678");
    expect(state.members[0]).toMatchObject({
      lastBotMessage: "Payment UID last 4 captured; awaiting screenshot",
    });
    expect(state.sent.at(-1)?.text).toContain("請再上傳轉帳截圖");
  });

  it("handles only UID captured (no screenshot) correctly", async () => {
    state.members = [
      member({
        status: "payment_pending",
        renewalStep: "payment_pending",
        paymentDeadlineAt: "2026-05-04T00:00:00.000Z",
      }),
    ];
    const now = new Date("2026-05-02T00:00:00.000Z");

    await handleTelegramUpdate(
      {
        update_id: 42,
        message: {
          message_id: 12,
          from: { id: 1001, username: "user" },
          chat: { id: 1001, type: "private" },
          text: "1234",
        },
      },
      now,
    );

    expect(state.members[0]).toMatchObject({
      paymentUidLast4: "1234",
      paymentProofFileId: "",
      lastBotMessage: "Payment UID last 4 captured; awaiting screenshot",
    });
    expect(state.sent.at(-1)?.text).toContain("請再上傳轉帳截圖");
  });

  it("handles only screenshot captured (no UID) correctly", async () => {
    state.members = [
      member({
        status: "payment_pending",
        renewalStep: "payment_pending",
        paymentDeadlineAt: "2026-05-04T00:00:00.000Z",
      }),
    ];
    const now = new Date("2026-05-02T00:00:00.000Z");

    await handleTelegramUpdate(
      {
        update_id: 43,
        message: {
          message_id: 13,
          from: { id: 1001, username: "user" },
          chat: { id: 1001, type: "private" },
          photo: [
            { file_id: "small", width: 90, height: 90 },
            { file_id: "large", width: 1280, height: 720 },
          ],
        },
      },
      now,
    );

    expect(state.members[0]).toMatchObject({
      paymentProofFileId: "large",
      paymentUidLast4: "",
      lastBotMessage: "Payment screenshot captured; awaiting UID last 4",
    });
    expect(state.sent.at(-1)?.text).toContain("請再回覆 UID 末四碼");
  });

  it("keeps exempt members non-expiring when they join through bot approval", async () => {
    state.members = [
      member({
        pageId: "page-1",
        telegramUserId: "1001",
        status: "exempt",
        groupJoinedAt: null,
        reviewDueAt: null,
      }),
    ];
    const now = new Date("2026-05-01T00:00:00.000Z");

    await handleTelegramUpdate(
      {
        update_id: 6,
        message: {
          message_id: 1,
          from: { id: 1001, username: "user" },
          chat: { id: 1001, type: "private" },
          text: "/start",
        },
      },
      now,
    );

    expect(state.invites).toHaveLength(1);
    expect(state.members[0]).toMatchObject({
      status: "exempt",
      inviteLink: "https://t.me/+invite",
    });

    await handleTelegramUpdate(
      {
        update_id: 7,
        chat_join_request: {
          chat: { id: -100 },
          from: { id: 1001, username: "user" },
          user_chat_id: 1001,
          date: Math.floor(now.getTime() / 1000),
          invite_link: { invite_link: "https://t.me/+invite" },
        },
      },
      now,
    );

    expect(state.members[0]).toMatchObject({
      status: "exempt",
      groupJoinedAt: "2026-05-01T00:00:00.000Z",
      reviewDueAt: null,
      inviteLink: null,
      inviteExpiresAt: null,
    });
    expect(state.sent.at(-1)?.text).toContain("免續費限制");
  });

});
