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
  listMembers: vi.fn(async () => state.members),
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
  approveChatJoinRequest: vi.fn(async () => undefined),
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
  declineChatJoinRequest: vi.fn(async () => undefined),
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

  it("sends a seven day renewal reminder only once", async () => {
    state.members = [member()];
    const now = new Date("2026-05-01T00:00:00.000Z");

    await runDailyMembershipJob(now);
    await runDailyMembershipJob(now);

    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].text).toContain("7 天後到期");
    expect(state.sent[0].text).not.toContain("MEXC - UID");
    expect(state.sent[0].text).not.toContain("BITMART");
    expect(state.sent[0].keyboard?.[0]?.[0]?.callback_data).toBe("trial_result:success");
    expect(state.members[0].status).toBe("sent_7day_survey");
    expect(state.members[0].renewalStep).toBe("awaiting_trial_result");
  });

  it("sends paid members a subscription reminder with early renewal action", async () => {
    state.members = [
      member({
        status: "active_paid",
      }),
    ];
    const now = new Date("2026-05-01T00:00:00.000Z");

    await runDailyMembershipJob(now);

    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].text).toContain("你的訂閱將在 7 天內到期");
    expect(state.sent[0].text).toContain("若你已決定續訂");
    expect(state.sent[0].text).not.toContain("MEXC - UID");
    expect(state.sent[0].text).not.toContain("BITMART");
    expect(state.sent[0].keyboard?.[0]?.[0]?.callback_data).toBe("renewal:stay");
    expect(state.members[0].status).toBe("sent_7day_survey");
  });

  it("collects trial result, final P/L, and sends manual payment instructions", async () => {
    // 7-day survey was already sent; member is awaiting trial result
    state.members = [
      member({
        status: "sent_7day_survey",
        renewalStep: "awaiting_trial_result",
        reviewDueAt: "2026-05-08T00:00:00.000Z",
      }),
    ];
    const now = new Date("2026-05-01T00:00:00.000Z");

    await handleTelegramUpdate(
      {
        update_id: 1,
        callback_query: {
          id: "cb-1",
          from: { id: 1001 },
          data: "trial_result:success",
        },
      },
      now,
    );
    expect(state.members[0].tags).toContain("翻倉成功");
    expect(state.members[0].renewalStep).toBe("awaiting_pnl");
    expect(state.sent.at(-1)?.text).toContain("請直接回覆目前的合約收益概略即可");

    await handleTelegramUpdate(
      {
        update_id: 2,
        message: {
          message_id: 1,
          from: { id: 1001, username: "user" },
          chat: { id: 1001, type: "private" },
          text: "+25%",
        },
      },
      now,
    );
    expect(state.members[0]).toMatchObject({
      finalPnl: "+25%",
      renewalStep: "renewal_offer_sent",
    });
    expect(state.sent.at(-1)?.keyboard?.[0]?.[0]?.callback_data).toBe("renewal:stay");

    await handleTelegramUpdate(
      {
        update_id: 3,
        callback_query: {
          id: "cb-2",
          from: { id: 1001 },
          data: "renewal:stay",
        },
      },
      now,
    );
    expect(state.members[0].status).toBe("payment_pending");
    expect(state.members[0].paymentDeadlineAt).toBe("2026-05-08T00:00:00.000Z"); // = reviewDueAt
    const paymentInstruction = state.sent.at(-2)?.text || "";
    expect(paymentInstruction).toContain("已收到你的續費申請");
    expect(paymentInstruction).toContain("3個月100U，一個月50U");
    expect(paymentInstruction).toContain("MEXC - UID：77242747");
    expect(paymentInstruction).toContain("上傳轉帳截圖");
    expect(paymentInstruction).toContain("UID 末四碼");
    expect(paymentInstruction).not.toContain("BITMART");
    expect(state.sent.at(-1)?.text).toContain("請上傳轉帳截圖");

    await handleTelegramUpdate(
      {
        update_id: 4,
        message: {
          message_id: 2,
          from: { id: 1001, username: "user" },
          chat: { id: 1001, type: "private" },
          caption: "UID 末四碼 1234",
          photo: [
            { file_id: "small-photo", width: 90, height: 90 },
            { file_id: "large-photo", width: 1280, height: 720 },
          ],
        },
      },
      now,
    );
    expect(state.members[0]).toMatchObject({
      paymentUidLast4: "1234",
      paymentProofFileId: "large-photo",
      paymentProofSubmittedAt: now.toISOString(),
    });
    expect(state.sent.at(-1)?.text).toContain("已收到你的轉帳截圖與 UID 末四碼");
  });

  it("visually marks clicked inline buttons as selected", async () => {
    state.members = [
      member({
        status: "renewal_due",
        renewalStep: "renewal_offer_sent",
        reviewDueAt: "2026-05-01T00:00:00.000Z",
      }),
    ];

    await handleTelegramUpdate(
      {
        update_id: 30,
        callback_query: {
          id: "cb-ui",
          from: { id: 1001 },
          data: "renewal:stay",
          message: {
            message_id: 99,
            chat: { id: 1001, type: "private" },
            text: "請確認是否要轉成續費的收費會員方案。",
          },
        },
      },
      new Date("2026-05-02T00:00:00.000Z"),
    );

    expect(state.callbackAnswers.at(-1)).toMatchObject({
      id: "cb-ui",
      text: "已收到：繼續訂閱。完成轉帳後，請在 Bot 對話上傳轉帳截圖與 UID 末四碼。",
      showAlert: true,
    });
    expect(state.edited.at(-1)).toMatchObject({
      chatId: 1001,
      messageId: 99,
    });
    expect(state.edited.at(-1)?.text).toContain("✅ 你已選擇：繼續訂閱");
    expect(state.edited.at(-1)?.text).toContain("上傳轉帳截圖與 UID 末四碼");
    expect(state.edited.at(-1)?.keyboard).toBeUndefined();
  });

  it("prompts members to upload proof after tapping the admin payment-proof option", async () => {
    state.members = [
      member({
        status: "payment_pending",
        renewalStep: "payment_pending",
        paymentDeadlineAt: "2026-05-04T00:00:00.000Z",
      }),
    ];

    await handleTelegramUpdate(
      {
        update_id: 31,
        callback_query: {
          id: "cb-proof",
          from: { id: 1001 },
          data: "payment_proof:start",
          message: {
            message_id: 100,
            chat: { id: 1001, type: "private" },
            text: "助理已開啟付款資料補傳流程。",
          },
        },
      },
      new Date("2026-05-02T00:00:00.000Z"),
    );

    expect(state.callbackAnswers.at(-1)).toMatchObject({
      id: "cb-proof",
      text: "請上傳轉帳截圖，並輸入 UID 末四碼。",
      showAlert: true,
    });
    expect(state.edited.at(-1)?.text).toContain(
      "✅ 你已選擇：我已完成轉帳，補傳付款資料",
    );
    expect(state.edited.at(-1)?.text).toContain(
      "請在這個 Bot 對話上傳轉帳截圖",
    );
    expect(state.sent.at(-1)?.text).toContain("上傳轉帳截圖");
    expect(state.sent.at(-1)?.text).toContain("UID 末四碼");
  });

  it("sets status to user_refused and keeps member in group when renewal:leave is clicked", async () => {
    state.members = [
      member({
        status: "renewal_due",
        renewalStep: "renewal_offer_sent",
        reviewDueAt: "2026-05-08T00:00:00.000Z",
        tradingView: "trader123",
        tradingViewAccess: "",
      }),
    ];

    await handleTelegramUpdate(
      {
        update_id: 99,
        callback_query: {
          id: "cb-leave",
          from: { id: 1001 },
          data: "renewal:leave",
        },
      },
      new Date("2026-05-01T00:00:00.000Z"),
    );

    expect(state.members[0]).toMatchObject({
      status: "user_refused",
      renewalStep: "completed",
    });
    expect(state.kicked).toHaveLength(0); // not kicked immediately — daily job handles it at expiry
    expect(state.members[0].tradingViewAccess).toBe(""); // not revoked until daily job kicks
  });

  it("keeps renewal buttons valid while in renewal_due, and blocks them once expired", async () => {
    // renewal_due member can still act even after reviewDueAt (daily job hasn't run yet)
    state.members = [
      member({
        status: "renewal_due",
        renewalStep: "renewal_offer_sent",
        reviewDueAt: "2026-05-01T00:00:00.000Z",
      }),
    ];

    await handleTelegramUpdate(
      {
        update_id: 20,
        callback_query: {
          id: "cb-stay",
          from: { id: 1001 },
          data: "renewal:stay",
        },
      },
      new Date("2026-05-02T00:00:00.000Z"),
    );

    expect(state.members[0].status).toBe("payment_pending");
    expect(state.sent.at(-2)?.text).toContain("已收到你的續費申請");
    expect(state.sent.at(-1)?.text).toContain("請上傳轉帳截圖");

    // Once daily job has kicked the member (status=expired), buttons no longer work
    state.members = [
      member({
        status: "expired",
        kickReason: "renewal_not_confirmed",
        reviewDueAt: "2026-05-01T00:00:00.000Z",
      }),
    ];
    state.sent = [];
    state.kicked = [];

    await handleTelegramUpdate(
      {
        update_id: 21,
        callback_query: {
          id: "cb-stale",
          from: { id: 1001 },
          data: "renewal:stay",
        },
      },
      new Date("2026-05-04T00:00:00.000Z"),
    );

    expect(state.members[0].status).toBe("expired"); // unchanged
    expect(state.kicked).toHaveLength(0);
    expect(state.sent.at(-1)?.text).toContain("這個按鈕已不是目前可操作的步驟");
  });

  it("does not accept stale trial result buttons after the member has moved on", async () => {
    state.members = [
      member({
        status: "payment_pending",
        renewalStep: "payment_pending",
        reviewDueAt: "2026-05-01T00:00:00.000Z",
      }),
    ];

    await handleTelegramUpdate(
      {
        update_id: 22,
        callback_query: {
          id: "cb-stale",
          from: { id: 1001 },
          data: "trial_result:success",
        },
      },
      new Date("2026-05-02T00:00:00.000Z"),
    );

    expect(state.members[0]).toMatchObject({
      status: "payment_pending",
      renewalStep: "payment_pending",
    });
    expect(state.members[0].tags).not.toContain("翻倉成功");
    expect(state.sent.at(-1)?.text).toContain("這個按鈕已不是目前可操作的步驟");
  });

  it("expires payment proof submissions after the payment deadline", async () => {
    state.members = [
      member({
        status: "payment_pending",
        renewalStep: "payment_pending",
        paymentDeadlineAt: "2026-05-04T00:00:00.000Z",
      }),
    ];

    await handleTelegramUpdate(
      {
        update_id: 23,
        message: {
          message_id: 1,
          from: { id: 1001, username: "user" },
          chat: { id: 1001, type: "private" },
          caption: "UID 末四碼 1234",
          photo: [{ file_id: "proof-photo", width: 1280, height: 720 }],
        },
      },
      new Date("2026-05-04T00:00:00.000Z"),
    );

    expect(state.members[0]).toMatchObject({
      status: "expired",
      kickReason: "payment_deadline_missed",
      paymentUidLast4: "",
      paymentProofFileId: "",
    });
    expect(state.kicked).toEqual(["1001"]);
    expect(state.sent.at(-1)?.text).toContain("付款回覆期限已過");
  });

  it("sends paid members directly to renewal without trial result questions", async () => {
    state.members = [
      member({
        status: "active_paid",
        reviewDueAt: "2026-05-01T00:00:00.000Z",
      }),
    ];

    await runDailyMembershipJob(new Date("2026-05-01T00:00:00.000Z"));

    expect(state.members[0]).toMatchObject({
      status: "renewal_due",
      renewalStep: "renewal_offer_sent",
    });
    expect(state.sent[0].text).toContain("你的訂閱已到期");
    expect(state.sent[0].text).not.toContain("翻倉成功");
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

  it("accepts MEXC UID and sends invite without API verification", async () => {
    state.members = [
      member({
        pageId: "page-1",
        telegramUserId: "1001",
        status: "collecting_info",
        exchangeUid: "",
      }),
    ];
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

    expect(state.mexcCalls).toHaveLength(0);
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

  it("accepts UID even when no Notion UID pre-filled", async () => {
    state.members = [
      member({
        pageId: "page-1",
        telegramUserId: "1001",
        status: "collecting_info",
        exchangeUid: "",
      }),
    ];

    await handleTelegramUpdate({
      update_id: 48,
      message: {
        message_id: 1,
        from: { id: 1001, username: "user" },
        chat: { id: 1001, type: "private" },
        text: "12345678",
      },
    });

    expect(state.mexcCalls).toHaveLength(0);
    expect(state.invites).toHaveLength(1);
    expect(state.members[0].exchangeUid).toBe("12345678");
    expect(state.members[0].exchangeRegistered).toBe(true);
  });

  it.each([
    ["expired", "已離開"],
    ["kicked", "已離開"],
    ["denied", "已拒絕"],
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
      expect(state.sent[0].text).toContain("目前無法提供入群連結");
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
    expect(state.sent[0].text).toContain("已離開");
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

  it("sends 3-day subscription offer before trial expires and sets sent_3day_offer", async () => {
    const now = new Date("2026-06-07T01:00:00.000Z");
    // reviewDueAt is exactly 3 days away
    state.members = [
      member({
        status: "trial_active",
        reviewDueAt: "2026-06-10T01:00:00.000Z",
      }),
    ];

    await runDailyMembershipJob(now);

    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].text).toContain("3 天內到期");
    expect(state.sent[0].keyboard).toBeDefined();
    expect(state.members[0]).toMatchObject({
      status: "sent_3day_offer",
      lastBotMessage: "3-day subscription offer sent",
    });
  });

  it("kicks renewal_due member on expiry day with no grace period", async () => {
    const now = new Date("2026-06-07T01:00:00.000Z");
    // reviewDueAt is in the past — expiry day has passed
    state.members = [
      member({
        telegramUserId: "1001",
        status: "renewal_due",
        renewalStep: "awaiting_trial_result",
        reviewDueAt: "2026-06-06T23:00:00.000Z",
      }),
    ];

    await runDailyMembershipJob(now);

    expect(state.kicked).toContain("1001");
    expect(state.members[0]).toMatchObject({
      status: "expired",
      kickReason: "renewal_not_confirmed",
    });
  });
});
