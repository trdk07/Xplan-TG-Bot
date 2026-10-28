import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Member, MemberPatch } from "@/lib/notion";

const state = vi.hoisted(() => ({
  member: null as Member | null,
  otherMembers: [] as Member[],
  writes: [] as MemberPatch[],
  telegram: [] as string[],
  messages: [] as string[],
  authorized: true,
}));
const external = vi.hoisted(() => ({
  reserve: vi.fn(),
  lock: vi.fn(),
  recheck: vi.fn(),
  invite: vi.fn(),
  renewal: vi.fn(),
  revalidate: vi.fn(),
  list: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: external.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  assertAdminAction: async () => {
    if (!state.authorized) throw new Error("Unauthorized");
  },
  requireAdmin: async () => {
    if (!state.authorized) throw new Error("Unauthorized");
  },
  getAdminOperator: async () => "Rick",
  clearAdminCookie: vi.fn(),
  setAdminCookie: vi.fn(),
}));
vi.mock("@/lib/config", () => ({
  getAdminPassword: () => "test-only",
  getRuntimeConfig: () => ({ paymentGraceDays: 3 }),
  getMissingConfig: () => [],
  getDisplayConfig: () => ({
    exchangeName: "MEXC",
    telegramGroupId: "test-group",
    notionDataSourceId: "test-source",
    trialDays: 30,
    paymentGraceDays: 3,
  }),
}));
vi.mock("@/lib/bot", () => ({
  manualPaymentProofRequestMessage: () => "付款資料",
  paymentProofRequestKeyboard: () => undefined,
  sendRenewalReminder: vi.fn(),
}));
vi.mock("@/lib/bot/v2", () => ({ createV2Invite: external.invite }));
vi.mock("@/lib/bot/v2-job", () => ({
  sendV2RenewalReminder: external.renewal,
}));
vi.mock("@/lib/qualification", () => ({
  recheckQualifications: external.recheck,
  withQualificationLock: external.lock,
  reserveBoundAccount: external.reserve,
}));
vi.mock("@/lib/notion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notion")>()),
  getMemberByPageId: async (id: string) =>
    id === state.member?.pageId ? { ...state.member } : null,
  listMembers: external.list,
  updateMember: async (_id: string, patch: MemberPatch) => {
    state.writes.push(patch);
    Object.assign(state.member!, patch);
  },
  updateMemberExistingProperties: async (_id: string, patch: MemberPatch) => {
    state.writes.push(patch);
    Object.assign(state.member!, patch);
    return Object.keys(patch).map((key) =>
      key === "renewalStep" ? "Renewal Step" : key,
    );
  },
}));
vi.mock("@/lib/telegram", () => ({
  unbanChatMember: async () => {
    state.telegram.push("unban");
  },
  createChatInviteLink: async () => {
    state.telegram.push("legacy-invite");
    return { invite_link: "https://t.me/+test" };
  },
  revokeChatInviteLink: async () => {
    state.telegram.push("revoke");
  },
  sendMessage: async (_id: string, message: string) => {
    state.telegram.push("message");
    state.messages.push(message);
  },
}));

import * as actions from "@/app/admin/actions";
import MemberDetailPage from "@/app/admin/member/[pageId]/page";
import AdminPage from "@/app/admin/page";
import TradingViewPage from "@/app/admin/tradingview/page";
import { mapNotionPageToMember } from "@/lib/notion";

const now = "2026-10-28T01:00:00.000Z";
function member(overrides: Partial<Member> = {}): Member {
  return {
    ...mapNotionPageToMember({ id: "member-1", properties: {} }),
    pageId: "member-1",
    telegramUsername: "@review_user",
    telegramUserId: "1000000000000001",
    email: "review@example.com",
    status: "active_volume",
    exchangeName: "Bitget",
    exchangeUid: "00012345",
    exchangeRegistered: true,
    onboardingStep: "needs_review",
    verifiedDepositUsdt: 99,
    depositEvidenceComplete: false,
    admissionVerifiedAt: "2026-10-01T01:00:00.000Z",
    volumeQualified: true,
    volumeSpot30d: 120000,
    volumeFutures30d: 100000,
    volumeTotal30d: 220000,
    volumeCheckedAt: "2026-10-26T01:00:00.000Z",
    volumeCheckError: "upstream_unavailable",
    volumeWindowStart: "2026-09-26T16:00:00.000Z",
    volumeWindowEnd: "2026-10-26T16:00:00.000Z",
    qualificationCheckedAt: now,
    qualificationFieldsAvailable: true,
    paidAt: null,
    reviewDueAt: null,
    discordId: "1524807192434311390",
    discordRole: "探索者",
    discordVerifiedAt: "2026-10-01T01:00:00.000Z",
    ...overrides,
  };
}
function form(values: Record<string, string>): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
function preview(name: string, html: string) {
  const directory = process.env.ADMIN_V2_VISUAL_OUTPUT;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, "globals.css"),
    readFileSync("app/globals.css"),
  );
  writeFileSync(
    path.join(directory, name),
    `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="globals.css"><title>新版會員後台驗收（測試資料）</title></head><body>${html}</body></html>`,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  vi.clearAllMocks();
  state.member = member();
  state.otherMembers = [];
  state.writes = [];
  state.telegram = [];
  state.messages = [];
  state.authorized = true;
  external.list.mockImplementation(async () => [
    state.member!,
    ...state.otherMembers,
  ]);
  external.recheck.mockImplementation(async () => state.member);
  external.reserve.mockReset().mockResolvedValue(undefined);
  external.lock.mockImplementation(
    async (
      _pageId: string,
      fn: (guard: () => Promise<void>) => Promise<unknown>,
    ) => fn(async () => {}),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const depositForm = () =>
  form({
    reason: "已核對交易所完整轉帳證明，含先前內部入金。",
    verifiedDepositUsdt: "100",
    evidenceComplete: "on",
  });
const accountForm = () => form({ exchange: "okx", exchangeUid: "00098765" });

describe("authenticated v2 qualification actions", () => {
  it.each(["recheck", "deposit", "account"])(
    "rejects unauthenticated %s before writing or upstream work",
    async (operation) => {
      state.authorized = false;
      const invoke =
        operation === "recheck"
          ? () => actions.recheckQualificationAction("member-1")
          : operation === "deposit"
            ? () =>
                actions.approveHistoricalDepositAction(
                  "member-1",
                  depositForm(),
                )
            : () => actions.resetBoundAccountAction("member-1", accountForm());
      await expect(invoke()).rejects.toThrow("Unauthorized");
      expect(state.writes).toEqual([]);
      expect(external.recheck).not.toHaveBeenCalled();
    },
  );
  it.each(["recheck", "deposit", "account"])(
    "rejects %s while v2 is disabled",
    async (operation) => {
      vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "false");
      const invoke =
        operation === "recheck"
          ? () => actions.recheckQualificationAction("member-1")
          : operation === "deposit"
            ? () =>
                actions.approveHistoricalDepositAction(
                  "member-1",
                  depositForm(),
                )
            : () => actions.resetBoundAccountAction("member-1", accountForm());
      await expect(invoke()).rejects.toThrow();
      expect(state.writes).toEqual([]);
    },
  );
  it("rechecks via server qualification pipeline and audits the operator", async () => {
    await actions.recheckQualificationAction("member-1");
    expect(external.recheck).toHaveBeenCalledWith("member-1", new Date(now));
    expect(state.member?.lastBotMessage).toContain("Rick");
    expect(external.revalidate).toHaveBeenCalledWith("/admin/member/member-1");
  });
  it("does not mutate evidence or revoke invites when another qualification task holds the lock", async () => {
    external.lock.mockRejectedValue(new Error("資格正在處理中"));
    await expect(
      actions.approveHistoricalDepositAction("member-1", depositForm()),
    ).rejects.toThrow("資格正在處理中");
    await expect(
      actions.resetBoundAccountAction("member-1", accountForm()),
    ).rejects.toThrow("資格正在處理中");
    expect(state.writes).toEqual([]);
    expect(state.telegram).toEqual([]);
  });
  it("rejects an expired qualification lock before authoritative evidence writes", async () => {
    external.lock.mockImplementation(
      async (
        _pageId: string,
        fn: (guard: () => Promise<void>) => Promise<unknown>,
      ) =>
        fn(async () => {
          throw new Error("鎖定已失效");
        }),
    );
    await expect(
      actions.approveHistoricalDepositAction("member-1", depositForm()),
    ).rejects.toThrow("鎖定已失效");
    await expect(
      actions.resetBoundAccountAction("member-1", accountForm()),
    ).rejects.toThrow("鎖定已失效");
    expect(state.writes).toEqual([]);
  });
  it("requires reason and verified referral before manually approving historical deposits", async () => {
    await expect(
      actions.approveHistoricalDepositAction(
        "member-1",
        form({ reason: " ", verifiedDepositUsdt: "100" }),
      ),
    ).rejects.toThrow();
    state.member = member({
      exchangeRegistered: false,
      admissionVerifiedAt: null,
    });
    await expect(
      actions.approveHistoricalDepositAction("member-1", depositForm()),
    ).rejects.toThrow();
    expect(state.writes).toEqual([]);
  });
  it("rejects manual historical deposit approval when the bound account is reserved by another member", async () => {
    state.member = member({
      exchangeRegistered: true,
      admissionVerifiedAt: null,
      volumeQualified: false,
    });
    external.reserve.mockRejectedValueOnce(new Error("此帳號已被其他會員綁定"));
    await expect(
      actions.approveHistoricalDepositAction("member-1", depositForm()),
    ).rejects.toThrow("此帳號已被其他會員綁定");
    expect(state.writes).toEqual([]);
    expect(state.member.admissionVerifiedAt).toBeNull();
    expect(state.member.volumeQualified).toBe(false);
    expect(state.telegram).toEqual([]);
  });
  it("rejects observed duplicate Notion bindings before manually approving historical deposits", async () => {
    state.otherMembers = [
      member({
        pageId: "duplicate",
        exchangeName: "bitget",
        exchangeUid: "00012345",
      }),
    ];
    await expect(
      actions.approveHistoricalDepositAction("member-1", depositForm()),
    ).rejects.toThrow();
    expect(state.writes).toEqual([]);
    expect(external.reserve).not.toHaveBeenCalled();
  });
  it("rejects 99.99 and accepts proven 100 with incomplete older history, preserving independent volume", async () => {
    await expect(
      actions.approveHistoricalDepositAction(
        "member-1",
        form({ reason: "已人工核對", verifiedDepositUsdt: "99.99" }),
      ),
    ).rejects.toThrow();
    state.member = member({
      admissionVerifiedAt: null,
      volumeQualified: false,
      volumeCheckedAt: null,
    });
    await actions.approveHistoricalDepositAction(
      "member-1",
      form({
        reason: "已核對含內部入金的歷史證明",
        verifiedDepositUsdt: "100",
      }),
    );
    expect(state.member).toMatchObject({
      admissionVerifiedAt: now,
      verifiedDepositUsdt: 100,
      depositEvidenceComplete: false,
      depositReviewedAt: now,
      depositReviewedBy: "Rick",
      onboardingStep: "eligible",
      volumeQualified: false,
    });
    expect(state.member?.depositReviewReason).toContain("內部入金");
    expect(external.reserve).toHaveBeenCalledWith(
      "member-1",
      "bitget",
      "00012345",
    );
    expect(state.writes[0]).not.toHaveProperty("exchangeRegistered");
    expect(state.writes[0]).not.toHaveProperty("volumeQualified");
    expect(state.writes[0]).not.toHaveProperty("paidAt");
  });
  it("accepts existing valid admission evidence without fabricating referral and retains its timestamp", async () => {
    state.member = member({
      exchangeRegistered: false,
      verifiedDepositUsdt: 200,
    });
    await actions.approveHistoricalDepositAction("member-1", depositForm());
    expect(state.member).toMatchObject({
      exchangeRegistered: false,
      admissionVerifiedAt: "2026-10-01T01:00:00.000Z",
      verifiedDepositUsdt: 200,
    });
  });
  it("rejects missing schema and future admission evidence without a verified referral", async () => {
    state.member = member({ qualificationFieldsAvailable: false });
    await expect(
      actions.approveHistoricalDepositAction("member-1", depositForm()),
    ).rejects.toThrow();
    state.member = member({
      exchangeRegistered: false,
      admissionVerifiedAt: "2099-01-01T00:00:00.000Z",
    });
    await expect(
      actions.approveHistoricalDepositAction("member-1", depositForm()),
    ).rejects.toThrow();
    expect(state.writes).toEqual([]);
  });
});

describe("bound account replacement", () => {
  it("rejects invalid exchange or numeric UID representations", async () => {
    for (const values of [
      { exchange: "unknown", exchangeUid: "12345" },
      { exchange: "okx", exchangeUid: "1e5" },
      { exchange: "okx", exchangeUid: "" },
    ])
      await expect(
        actions.resetBoundAccountAction("member-1", form(values)),
      ).rejects.toThrow();
    expect(state.writes).toEqual([]);
  });
  it("checks all members and rejects a canonical/legacy-alias duplicate", async () => {
    state.otherMembers = [
      member({
        pageId: "other",
        exchangeName: "Mexc（抹茶）",
        exchangeUid: "00098765",
      }),
    ];
    await expect(
      actions.resetBoundAccountAction(
        "member-1",
        form({ exchange: "mexc", exchangeUid: "00098765" }),
      ),
    ).rejects.toThrow();
    expect(external.list).toHaveBeenCalledWith();
    expect(state.writes).toEqual([]);
  });
  it("does not reset or revoke the current invite when another member reserved the target account", async () => {
    state.member = member({ inviteLink: "https://t.me/+current" });
    external.reserve.mockRejectedValueOnce(new Error("此帳號已被綁定"));
    await expect(
      actions.resetBoundAccountAction("member-1", accountForm()),
    ).rejects.toThrow("此帳號已被綁定");
    expect(state.writes).toEqual([]);
    expect(state.telegram).toEqual([]);
  });
  it("allows same UID at another exchange and clears old qualification/invite evidence, preserving paid and Discord facts", async () => {
    state.member = member({
      status: "active_paid",
      paidAt: "2026-10-01T01:00:00.000Z",
      reviewDueAt: "2026-11-01T01:00:00.000Z",
      inviteLink: "https://t.me/+old",
      inviteExpiresAt: "2026-10-29T01:00:00.000Z",
      groupJoinedAt: "2026-10-02T01:00:00.000Z",
      depositReviewedBy: "小夏",
    });
    state.otherMembers = [
      member({
        pageId: "other",
        exchangeName: "MEXC",
        exchangeUid: "00098765",
      }),
    ];
    await actions.resetBoundAccountAction("member-1", accountForm());
    expect(state.member).toMatchObject({
      exchangeName: "OKX",
      exchangeUid: "00098765",
      status: "active_paid",
      exchangeRegistered: false,
      onboardingStep: "collecting_info",
      admissionVerifiedAt: null,
      verifiedDepositUsdt: null,
      depositEvidenceComplete: false,
      depositReviewedBy: "",
      depositReviewedAt: null,
      volumeQualified: false,
      volumeSpot30d: null,
      volumeFutures30d: null,
      volumeTotal30d: null,
      volumeCheckedAt: null,
      volumeWindowStart: null,
      volumeWindowEnd: null,
      volumeCheckError: "",
      qualificationCheckedAt: null,
      inviteLink: null,
      inviteExpiresAt: null,
      invitationEmailSent: false,
      paidAt: "2026-10-01T01:00:00.000Z",
      reviewDueAt: "2026-11-01T01:00:00.000Z",
      discordRole: "探索者",
      groupJoinedAt: "2026-10-02T01:00:00.000Z",
    });
    expect(state.writes[0]).not.toHaveProperty("discordRole");
    expect(state.writes[0]).not.toHaveProperty("paidAt");
    expect(state.telegram).toEqual(["revoke"]);
  });
  it.each(["partner", "suspended"] as const)(
    "preserves %s semantics during account reset",
    async (status) => {
      state.member = member({ status });
      await actions.resetBoundAccountAction("member-1", accountForm());
      expect(state.member?.status).toBe(status);
    },
  );
});

describe("v2 authoritative status mutations share the qualification lease", () => {
  const invoke = (operation: string) =>
    operation === "paid"
      ? actions.markPaidAction("member-1", 1)
      : operation === "status"
        ? actions.updateStatusAction("member-1", form({ status: "partner" }))
        : actions.kickMemberAction("member-1");

  it.each(["paid", "status", "suspend"])(
    "blocks %s while another qualification operation owns the lease",
    async (operation) => {
      external.lock.mockRejectedValue(new Error("資格正在處理中"));
      await expect(invoke(operation)).rejects.toThrow("資格正在處理中");
      expect(external.lock).toHaveBeenCalledWith(
        "member-1",
        expect.any(Function),
      );
      expect(state.writes).toEqual([]);
      expect(state.telegram).toEqual([]);
    },
  );

  it.each(["paid", "status", "suspend"])(
    "checks the current lease before %s writes",
    async (operation) => {
      external.lock.mockImplementation(
        async (
          _pageId: string,
          work: (guard: () => Promise<void>) => Promise<unknown>,
        ) =>
          work(async () => {
            throw new Error("鎖定已失效");
          }),
      );
      await expect(invoke(operation)).rejects.toThrow("鎖定已失效");
      expect(state.writes).toEqual([]);
      expect(state.telegram).toEqual([]);
    },
  );

  it.each(["paid", "status", "suspend"])(
    "keeps legacy %s behavior independent of v2 D1 locks",
    async (operation) => {
      vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "false");
      external.lock.mockRejectedValue(new Error("不應使用新版鎖"));
      await invoke(operation);
      expect(external.lock).not.toHaveBeenCalled();
      expect(state.writes).toHaveLength(1);
    },
  );
});

describe("v2 payment and membership boundaries", () => {
  it.each([1, 3] as const)(
    "approves %s months from an existing valid paid period and clears request/reminder markers",
    async (months) => {
      state.member = member({
        status: "active_volume",
        paidAt: "2026-10-01T01:00:00.000Z",
        reviewDueAt: "2026-11-01T01:00:00.000Z",
        paymentProofFileId: "proof",
        paymentUidLast4: "1234",
        paymentProofSubmittedAt: now,
        renewalStep: "payment_pending",
        renewalReminderSentAt: now,
        renewalReminderDueAt: now,
      });
      await actions.markPaidAction("member-1", months);
      expect(state.member).toMatchObject({
        status: "active_paid",
        reviewDueAt:
          months === 1
            ? "2026-12-01T01:00:00.000Z"
            : "2027-02-01T01:00:00.000Z",
        subscriptionMonths: months,
        renewalStep: "",
        paymentProofFileId: "",
        paymentUidLast4: "",
        paymentProofSubmittedAt: null,
        paymentDeadlineAt: null,
        renewalReminderSentAt: null,
        renewalReminder3DaySentAt: null,
        renewalReminderDueAt: null,
        volumeQualified: true,
      });
      expect(state.writes[0]).not.toHaveProperty("volumeQualified");
    },
  );
  it.each([
    { status: "trial_active", paidAt: "2026-10-01T01:00:00.000Z" },
    { status: "payment_pending", paidAt: "2026-10-01T01:00:00.000Z" },
    { status: "collecting_info", paidAt: "2026-10-01T01:00:00.000Z" },
    { status: "trial_active", paidAt: now },
  ] as const)(
    "explicit new payment approves legacy $status with consistent status/message and no old trial deadline",
    async ({ status, paidAt }) => {
      state.member = member({
        status,
        paidAt,
        reviewDueAt: "2099-12-01T01:00:00.000Z",
      });
      await actions.markPaidAction("member-1", 1);
      expect(state.member).toMatchObject({
        status: "active_paid",
        paidAt: now,
        reviewDueAt: "2026-11-28T01:00:00.000Z",
      });
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toContain("目前會籍：訂閱中");
      expect(state.messages[0]).not.toContain("免費會員");
    },
  );
  it.each(["kicked", "denied"] as const)(
    "explicit new payment retains legacy %s blocking in status and message",
    async (status) => {
      state.member = member({ status, paidAt: null, reviewDueAt: null });
      await actions.markPaidAction("member-1", 1);
      expect(state.member).toMatchObject({
        status: "suspended",
        paidAt: now,
        reviewDueAt: "2026-11-28T01:00:00.000Z",
      });
      expect(state.messages[0]).toContain("目前會籍：會籍停用");
    },
  );
  it.each([null, "2099-01-01T00:00:00.000Z", "invalid"])(
    "does not extend a trial/invalid due date without valid paidAt (%s)",
    async (paidAt) => {
      state.member = member({
        status: "trial_active",
        paidAt,
        reviewDueAt: "2099-12-01T01:00:00.000Z",
      });
      await actions.markPaidAction("member-1", 1);
      expect(state.member?.reviewDueAt).toBe("2026-11-28T01:00:00.000Z");
    },
  );
  it.each(["partner", "exempt", "VIP", "suspended"] as const)(
    "records paid facts but keeps %s priority",
    async (status) => {
      state.member = member({ status, kickReason: "手動停用" });
      await actions.markPaidAction("member-1", 1);
      expect(state.member?.status).toBe(status);
      expect(state.member?.paidAt).toBe(now);
      expect(state.messages[0]).toContain(
        `目前會籍：${{ partner: "合作夥伴", exempt: "免除資格", VIP: "VIP", suspended: "會籍停用" }[status]}`,
      );
      if (status === "suspended")
        expect(state.member?.kickReason).toBe("手動停用");
    },
  );
  it("validates 1/3-month plans even for direct server action invocation", async () => {
    await expect(actions.markPaidAction("member-1", 2 as 1)).rejects.toThrow();
    expect(state.writes).toEqual([]);
  });
  it.each([
    "free",
    "active_volume",
    "active_paid",
    "partner",
    "suspended",
  ] as const)(
    "payment request preserves %s tier without creating membership evidence",
    async (status) => {
      state.member = member({ status });
      await actions.requestPaymentProofAction("member-1");
      expect(state.member?.status).toBe(status);
      expect(
        state.writes.every(
          (patch) =>
            !("status" in patch) &&
            !("paidAt" in patch) &&
            !("volumeQualified" in patch),
        ),
      ).toBe(true);
    },
  );
  it("busy qualification lease prevents payment request writes and notifications", async () => {
    external.lock.mockRejectedValue(new Error("資格正在處理中"));
    await expect(actions.requestPaymentProofAction("member-1")).rejects.toThrow(
      "資格正在處理中",
    );
    expect(state.writes).toEqual([]);
    expect(state.telegram).toEqual([]);
  });
  it("expired payment request lease preserves cycle/proof and permits only failure audit fallback", async () => {
    state.member = member({
      renewalStep: "",
      paymentDeadlineAt: null,
      paymentProofFileId: "old-proof",
      paymentUidLast4: "1234",
      paymentProofSubmittedAt: "2026-10-01T01:00:00.000Z",
    });
    external.lock.mockImplementation(
      async (
        _pageId: string,
        work: (guard: () => Promise<void>) => Promise<unknown>,
      ) =>
        work(async () => {
          throw new Error("鎖定已失效");
        }),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await actions.requestPaymentProofAction("member-1");
    } finally {
      log.mockRestore();
    }
    expect(state.member).toMatchObject({
      renewalStep: "",
      paymentDeadlineAt: null,
      paymentProofFileId: "old-proof",
      paymentUidLast4: "1234",
      paymentProofSubmittedAt: "2026-10-01T01:00:00.000Z",
    });
    expect(
      state.writes.every((patch) =>
        Object.keys(patch).every((key) =>
          ["lastBotCheckAt", "lastBotMessage"].includes(key),
        ),
      ),
    ).toBe(true);
    expect(state.member?.lastBotMessage).toContain("鎖定已失效");
    expect(state.telegram).toEqual([]);
  });
  it("legacy payment requests remain independent of D1 qualification leases", async () => {
    vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "false");
    state.member = member({
      status: "active_paid",
      paidAt: "2026-10-01T01:00:00.000Z",
      reviewDueAt: "2026-11-01T01:00:00.000Z",
    });
    external.lock.mockRejectedValue(new Error("不應使用新版鎖"));
    await actions.requestPaymentProofAction("member-1");
    expect(external.lock).not.toHaveBeenCalled();
    expect(state.member).toMatchObject({
      status: "payment_pending",
      renewalStep: "payment_pending",
    });
    expect(state.telegram).toEqual(["message"]);
  });
  it("disables trial extension and suspends membership without Telegram removal", async () => {
    await expect(actions.extendTrialAction("member-1")).rejects.toThrow();
    expect(state.writes).toEqual([]);
    await actions.kickMemberAction("member-1");
    expect(state.member?.status).toBe("suspended");
    expect(state.telegram).toEqual([]);
  });
  it("delegates v2 invitations with exact bound Telegram identity", async () => {
    await actions.resendInviteAction("member-1");
    expect(external.invite).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: "member-1" }),
      "1000000000000001",
      new Date(now),
    );
    expect(state.telegram).toEqual([]);
  });
  it.each(["trial_active", "eligible", "active_paid", "active_volume"])(
    "rejects direct status=%s instead of fabricating automatic evidence",
    async (status) => {
      await expect(
        actions.updateStatusAction("member-1", form({ status })),
      ).rejects.toThrow();
      expect(state.writes).toEqual([]);
    },
  );
  it("bulk renewal uses the deduplicated v2 sender and holds unknown outcomes instead of legacy sends", async () => {
    state.member = member({
      status: "active_paid",
      paidAt: "2026-10-01T01:00:00.000Z",
      reviewDueAt: "2026-10-30T01:00:00.000Z",
      renewalReminderDueAt: "2026-10-30T01:00:00.000Z",
      renewalReminder3DaySentAt: now,
    });
    await actions.resendRenewalRemindersAction();
    expect(external.renewal).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: "member-1" }),
      new Date(now),
      "3day",
    );
    expect(state.telegram).toEqual([]);
    external.renewal.mockRejectedValueOnce(new Error("結果不明，需人工覆核"));
    await expect(actions.resendRenewalRemindersAction()).rejects.toThrow(
      "需人工覆核",
    );
  });
  it("does not send bulk payment-followup notifications in v2", async () => {
    state.member = member({
      status: "free",
      renewalStep: "payment_pending",
      paymentDeadlineAt: "2026-10-30T01:00:00.000Z",
    });
    await actions.resendRenewalRemindersAction();
    expect(external.renewal).not.toHaveBeenCalled();
    expect(state.telegram).toEqual([]);
  });
  it("UID CSV queues review without setting referral, deposits or admission", async () => {
    await actions.batchMarkEligibleAction(form({ pageIds: '["member-1"]' }));
    expect(state.member?.onboardingStep).toBe("needs_review");
    expect(state.writes[0]).not.toHaveProperty("status");
    expect(state.writes[0]).not.toHaveProperty("admissionVerifiedAt");
    expect(state.writes[0]).not.toHaveProperty("exchangeRegistered");
    expect(state.writes[0]).not.toHaveProperty("verifiedDepositUsdt");
  });
});

describe("v2 admin evidence presentation", () => {
  it("previews fresh paid deadlines for an ambiguous legacy trial instead of its old2099 cutoff", async () => {
    state.member = member({
      status: "trial_active",
      paidAt: "2026-10-01T01:00:00.000Z",
      reviewDueAt: "2099-12-01T01:00:00.000Z",
    });
    const html = renderToStaticMarkup(
      await MemberDetailPage({
        params: Promise.resolve({ pageId: "member-1" }),
      }),
    );
    const previews = [
      ...html.matchAll(
        /class="confirm-btn-preview">到期日將變為：([^<]+)<\/span>/g,
      ),
    ].map((match) => match[1]);
    expect(previews).toEqual([
      "2026年11月28日 上午9:00",
      "2027年1月28日 上午9:00",
    ]);
  });
  it("shows persisted evidence, stale errors and writeback roles; hides trial/manual automatic tiers", async () => {
    const html = renderToStaticMarkup(
      await MemberDetailPage({
        params: Promise.resolve({ pageId: "member-1" }),
      }),
    );
    preview("member-v2.html", html);
    expect(html).toContain("歷史入金人工覆核");
    expect(html).toContain("重新檢查資格");
    expect(html).toContain("220,000");
    expect(html).toContain("上次成功資料");
    expect(html).toContain("upstream_unavailable");
    expect(html).toContain("身分組：探索者");
    expect(html).toContain("Discord 重新驗證");
    expect(html).not.toContain("延長體驗期");
    expect(html).not.toContain('<option value="active_volume"');
    expect(html).not.toContain('<option value="trial_active"');
  });
  it("shows review queue and qualification evidence in main list without trial stats", async () => {
    const html = renderToStaticMarkup(
      await AdminPage({ searchParams: Promise.resolve({}) }),
    );
    preview("admin-v2.html", html);
    expect(html).toContain("資格待覆核");
    expect(html).not.toContain("所有會員狀態正常");
    expect(html).toContain(
      "目前沒有付款或續費待辦；資格查核異常請查看覆核清單。",
    );
    expect(html).toContain("@review_user");
    expect(html).toContain("220,000");
    expect(html).not.toContain("體驗中");
    expect(html).not.toContain("Trial / Grace");
  });
  it("shows provider switches as authoritative only after unit, coverage and window verification", async () => {
    vi.stubEnv("BITGET_VOLUME_ENABLED", "true");
    vi.stubEnv("BITGET_VOLUME_UNIT_VERIFIED", "false");
    let html = renderToStaticMarkup(
      await AdminPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("Bitget：入群關閉／交易量待核實");
    for (const key of ["UNIT", "COVERAGE", "WINDOW"])
      vi.stubEnv(`BITGET_VOLUME_${key}_VERIFIED`, "true");
    html = renderToStaticMarkup(
      await AdminPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("Bitget：入群關閉／交易量啟用");
  });
  it("queues unbound premium Discord writeback for manual review without inferring or changing roles", async () => {
    state.member = member({
      discordRole: "宇航員",
      discordId: "",
      discordVerifiedAt: null,
      onboardingStep: "joined",
      volumeCheckError: "",
    });
    const html = renderToStaticMarkup(
      await AdminPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("Discord 身分組待覆核");
    expect(html).toContain("身分組：宇航員");
    expect(html).not.toContain("交易量查詢異常，保留上次成功證據");
    expect(state.writes).toEqual([]);
  });
  it("keeps volume members in TradingView list and removes trial grouping", async () => {
    state.member = member({
      tradingView: "Volume_Account",
      onboardingStep: "joined",
    });
    const html = renderToStaticMarkup(await TradingViewPage());
    expect(html).toContain("Volume_Account");
    expect(html).toContain("交易量會員");
    expect(html).not.toContain("<h2>體驗期</h2>");
  });
});
