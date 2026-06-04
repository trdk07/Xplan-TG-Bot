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
    expect(state.sent[0].text).toContain("你的體驗期將在 7 天內到期");
    expect(state.sent[0].text).toContain("3個月100U，一個月50U");
    expect(state.sent[0].text).not.toContain("MEXC - UID");
    expect(state.sent[0].text).not.toContain("BITMART");
    expect(state.sent[0].keyboard?.[0]?.[0]).toMatchObject({
      text: "提前開始續費",
      callback_data: "renewal:stay",
    });
    expect(state.members[0].renewalReminderSentAt).toBe(now.toISOString());
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
    expect(state.sent[0].text).toContain("你的訂閱期將在 7 天內到期");
    expect(state.sent[0].text).toContain(
      "若你已決定續費，也可點擊下方按鈕提前開始續費申請",
    );
    expect(state.sent[0].text).not.toContain("MEXC - UID");
    expect(state.sent[0].text).not.toContain("BITMART");
    expect(state.sent[0].keyboard?.[0]?.[0]?.callback_data).toBe(
      "renewal:stay",
    );
  });

  it("collects trial result, final P/L, and sends manual payment instructions", async () => {
    state.members = [
      member({
        reviewDueAt: "2026-05-01T00:00:00.000Z",
      }),
    ];
    const now = new Date("2026-05-01T00:00:00.000Z");

    await runDailyMembershipJob(now);
    expect(state.members[0]).toMatchObject({
      status: "renewal_due",
      renewalStep: "awaiting_trial_result",
    });
    expect(state.sent.at(-1)?.text).toContain("翻倉成功");

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
    expect(state.sent.at(-1)?.text).toContain(
      "請直接回覆目前的合約收益概略即可",
    );

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
    expect(state.sent.at(-1)?.keyboard?.[0]?.[0]?.callback_data).toBe(
      "renewal:stay",
    );

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
    expect(state.members[0].paymentDeadlineAt).toBe("2026-05-04T00:00:00.000Z");
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
    expect(state.sent.at(-1)?.text).toContain(
      "已收到你的轉帳截圖與 UID 末四碼",
    );
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
      text: "已收到：繼續留下來。完成轉帳後，請在 Bot 對話上傳轉帳截圖與 UID 末四碼。",
      showAlert: true,
    });
    expect(state.edited.at(-1)).toMatchObject({
      chatId: 1001,
      messageId: 99,
    });
    expect(state.edited.at(-1)?.text).toContain("✅ 你已選擇：繼續留下來");
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

  it("sets tradingViewAccess to 待撤銷 when kicking a member with tradingView via renewal:leave", async () => {
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
      status: "kicked",
      kickReason: "user_declined_renewal",
      tradingViewAccess: "待撤銷",
    });
    expect(state.kicked).toContain("1001");
  });

  it("keeps delayed renewal buttons valid during grace but expires them after grace", async () => {
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
          id: "cb-grace",
          from: { id: 1001 },
          data: "renewal:stay",
        },
      },
      new Date("2026-05-03T00:00:00.000Z"),
    );

    expect(state.members[0].status).toBe("payment_pending");
    expect(state.sent.at(-2)?.text).toContain("已收到你的續費申請");
    expect(state.sent.at(-1)?.text).toContain("請上傳轉帳截圖");

    state.members = [
      member({
        status: "renewal_due",
        renewalStep: "renewal_offer_sent",
        reviewDueAt: "2026-05-01T00:00:00.000Z",
      }),
    ];
    state.sent = [];
    state.kicked = [];

    await handleTelegramUpdate(
      {
        update_id: 21,
        callback_query: {
          id: "cb-expired",
          from: { id: 1001 },
          data: "renewal:stay",
        },
      },
      new Date("2026-05-04T00:00:00.000Z"),
    );

    expect(state.members[0]).toMatchObject({
      status: "expired",
      kickReason: "renewal_not_confirmed",
    });
    expect(state.kicked).toEqual(["1001"]);
    expect(state.sent.at(-1)?.text).toContain("這次續費回覆期限已過");
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
    expect(state.sent[0].text).toContain("付費會籍已到期");
    expect(state.sent[0].text).not.toContain("翻倉成功");
  });

  it("sends an invite on start without asking for exchange registration or UID", async () => {
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

    expect(state.invites).toHaveLength(1);
    expect(state.unbanned).toEqual(["1001"]);
    expect(state.members[0]).toMatchObject({
      status: "join_pending",
      telegramUsername: "@user",
    });
    expect(state.sent[0].text).toContain("專屬短效入群連結");
    expect(state.sent[0].text).not.toContain("交易所");
    expect(state.sent[0].text).not.toContain("UID");
  });

  it.each([
    ["expired", "已過期"],
    ["kicked", "已踢出"],
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
    expect(state.sent[0].text).toContain("已踢出");
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
