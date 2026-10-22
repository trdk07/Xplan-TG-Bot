import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Member } from "@/lib/notion";
import { activeTradingViewIds } from "@/lib/partner-tradingview";
import { GET } from "@/app/api/partners/tradingview-members/route";

const state = {
  members: [] as any[],
};

vi.mock("@/lib/notion", () => ({
  listMembers: vi.fn(async () => state.members),
}));

const requiredEnv = {
  TELEGRAM_BOT_TOKEN: "token",
  TELEGRAM_WEBHOOK_SECRET: "secret",
  TELEGRAM_GROUP_ID: "-100",
  NOTION_API_KEY: "notion",
  NOTION_DATA_SOURCE_ID: "source",
  ADMIN_PASSWORD: "admin",
  APP_BASE_URL: "https://app.example",
};

function member(overrides: Record<string, any> = {}): Member {
  return {
    pageId: "page-1",
    telegramUserId: "1001",
    telegramUsername: "@user",
    email: "user@example.com",
    discordId: "",
    discordVerifiedAt: null,
    discordRole: null,
    subscriptionMonths: null,
    status: "trial_active",
    tags: [],
    exchangeRegistered: true,
    exchangeName: "MEXC",
    exchangeUid: "UID-1",
    invitationEmailSent: false,
    uidSubmittedAt: null,
    inviteLink: null,
    inviteExpiresAt: null,
    groupJoinedAt: null,
    reviewDueAt: "2099-01-01T00:00:00Z",
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
    tradingView: "tv_user_1",
    ...overrides,
  };
}

describe("partner TradingView member API", () => {
  beforeEach(() => {
    vi.stubEnv("PARTNER_API_TOKEN", "partner-secret");
    for (const [key, value] of Object.entries(requiredEnv)) {
      vi.stubEnv(key, value);
    }
    state.members = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects requests without the partner bearer token", async () => {
    const response = await GET(
      new Request("https://app.example/api/partners/tradingview-members"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
  });

  it("returns unique TradingView ids for current membership, independently of Telegram presence", async () => {
    state.members = [
      member({ status: "trial_active", tradingView: "tv_user_1" }),
      member({ status: "renewal_due", tradingView: "tv_user_2" }),
      member({ status: "payment_pending", tradingView: " tv_user_2 " }),
      member({ status: "active_paid", tradingView: "tv_user_3" }),
      member({ status: "partner", tradingView: "tv_partner" }),
      member({ status: "exempt", tradingView: "tv_exempt" }),
      member({ status: "VIP", tradingView: "tv_vip" }),
      member({ status: "expired", tradingView: "tv_expired" }),
      member({ status: "kicked", tradingView: "tv_kicked" }),
      member({ status: "trial_active", tradingView: "" }),
    ];

    const response = await GET(
      new Request("https://app.example/api/partners/tradingview-members", {
        headers: { authorization: "Bearer partner-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      count: 6,
      tradingViewIds: [
        "tv_user_1",
        "tv_user_2",
        "tv_user_3",
        "tv_partner",
        "tv_exempt",
        "tv_vip",
      ],
    });
  });
  it("preserves a legacy member's remaining generic access without guessing their tier", () => {
    const now = new Date("2026-10-22T00:00:00Z");
    const records = [
      member({status:"sent_7day_survey",tradingView:"legacy_trial"}),
      member({status:"sent_3day_offer",tradingView:"legacy_paid",paidAt:"2026-01-01T00:00:00Z"}),
      member({status:"user_refused",tradingView:"legacy_declined"}),
      member({status:"active_paid",tradingView:"expired_date",reviewDueAt:now.toISOString()}),
      member({status:"payment_pending",tradingView:"no_due",reviewDueAt:null}),
      member({status:"invite_sent",tradingView:"never_joined"}),
    ];
    expect(activeTradingViewIds(records, now)).toEqual(["legacy_trial", "legacy_paid", "legacy_declined"]);
  });

});
