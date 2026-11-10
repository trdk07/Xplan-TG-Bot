import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  forceReply: vi.fn(),
  answer: vi.fn(),
}));
vi.mock("@/lib/telegram", () => ({
  sendMessage: mocks.send,
  sendForceReply: mocks.forceReply,
  answerCallbackQuery: mocks.answer,
  revokeChatInviteLink: vi.fn(),
}));
vi.mock("@/lib/notion", () => ({
  getMemberByPageId: vi.fn(),
  listMembers: vi.fn(),
  updateMember: vi.fn(),
}));
vi.mock("@/lib/qualification", () => ({
  qualificationError: (error: any) => error?.message || "upstream_unavailable",
  recheckQualifications: vi.fn(),
}));
vi.mock("@/lib/evidence-store", () => ({ getEvidenceStore: vi.fn() }));
vi.mock("@/lib/config", () => ({
  getRuntimeConfig: () => ({ teacherTelegramUid: "1" }),
}));
import {
  handleRebindCallback,
  handleRebindUid,
  rebindAccount,
  rebindExchangeFromReply,
  rebindPrompt,
} from "@/lib/bot/rebind";
import { accountRebindPatch } from "@/lib/account-rebind";

const now = new Date("2026-11-10T01:00:00Z");
const member = {
  pageId: "p1",
  status: "active_paid",
  exchangeName: "Mexc（抹茶）",
  exchangeUid: "111",
  email: "a@example.com",
  paidAt: "2026-11-01T00:00:00Z",
  reviewDueAt: "2026-12-01T00:00:00Z",
  groupJoinedAt: "2026-10-01T00:00:00Z",
  admissionVerifiedAt: "2026-10-01T00:00:00Z",
  volumeQualified: true,
  inviteLink: null,
} as any;

function deps(overrides: Record<string, any> = {}) {
  let current = { ...member };
  const d = {
    read: vi.fn(async () => current),
    list: vi.fn(async () => [current]),
    write: vi.fn(async (_id: string, patch: any) => {
      current = { ...current, ...patch };
    }),
    store: {
      withQualificationLock: async (_id: string, work: any) =>
        work(async () => {}),
      reserveAccount: vi.fn(async () => undefined),
      recordDeposits: vi.fn(async () => undefined),
      depositTotal: vi.fn(async () => "0"),
    },
    client: {
      admission: vi.fn(async () => ({
        referral: true,
        cumulative: "150",
        complete: true,
        events: [],
      })),
    },
    revokeInvite: vi.fn(async () => undefined),
    recheck: vi.fn(async () => undefined),
    ...overrides,
  };
  return d as any;
}
beforeEach(() => vi.clearAllMocks());

it("keeps payment facts, records the previous account and admits the new one", () => {
  const patch = accountRebindPatch(member, "bitget", "222", now, "test", {
    verifiedDepositUsdt: 150,
    depositEvidenceComplete: true,
  });
  expect(patch).toMatchObject({
    previousExchange: "MEXC",
    previousExchangeUid: "111",
    exchangeName: "Bitget",
    exchangeUid: "222",
    admissionVerifiedAt: now.toISOString(),
    onboardingStep: "joined",
    volumeQualified: false,
    status: "active_paid",
  });
  expect(patch).not.toHaveProperty("paidAt");
  expect(patch).not.toHaveProperty("reviewDueAt");
});
it("rebinds only after the new account passes referral and deposit checks", async () => {
  const d = deps();
  const result = await rebindAccount("p1", "bitget", "222", now, d);
  expect(result.kind).toBe("rebound");
  expect(d.client.admission).toHaveBeenCalledWith("bitget", "222");
  expect(d.store.reserveAccount).toHaveBeenCalledWith("p1", "bitget", "222");
  expect(d.write.mock.calls[0][1]).toMatchObject({ exchangeUid: "222" });
  expect(d.recheck).toHaveBeenCalled();
});
it("leaves the binding untouched when the new account is not ours", async () => {
  const d = deps({
    client: {
      admission: vi.fn(async () => ({
        referral: false,
        cumulative: "0",
        complete: true,
        events: [],
      })),
    },
  });
  expect((await rebindAccount("p1", "okx", "333", now, d)).kind).toBe(
    "not_qualified",
  );
  expect(d.write).not.toHaveBeenCalled();
  expect(d.store.reserveAccount).not.toHaveBeenCalled();
});
it("treats an unavailable exchange check as manual review, not rejection", async () => {
  const d = deps({
    client: {
      admission: vi.fn(async () => {
        throw new Error("admission_disabled");
      }),
    },
  });
  const result = await rebindAccount("p1", "okx", "333", now, d);
  expect(result).toEqual({ kind: "needs_review", reason: "admission_disabled" });
  expect(d.write).not.toHaveBeenCalled();
});
it("refuses an account bound to another member", async () => {
  const d = deps();
  d.list.mockResolvedValue([
    member,
    { ...member, pageId: "p2", exchangeName: "Bitget", exchangeUid: "222" },
  ]);
  expect((await rebindAccount("p1", "bitget", "222", now, d)).kind).toBe(
    "duplicate",
  );
  expect(d.client.admission).not.toHaveBeenCalled();
});
it("recognises replies to the rebind prompt only", () => {
  expect(
    rebindExchangeFromReply({
      reply_to_message: { text: rebindPrompt("okx") },
    } as any),
  ).toBe("okx");
  expect(
    rebindExchangeFromReply({ reply_to_message: { text: "hello" } } as any),
  ).toBeNull();
  expect(rebindExchangeFromReply({ text: "123" } as any)).toBeNull();
});
it("asks for a UID with a reply prompt after an exchange is chosen", async () => {
  await handleRebindCallback(
    { id: "q", from: { id: 9 }, data: "rebind:exchange:bitget" } as any,
    member,
  );
  expect(mocks.forceReply).toHaveBeenCalledWith(
    9,
    expect.stringContaining("更換綁定：請回覆新的 Bitget UID"),
    "新帳號 UID",
  );
});
it("tells the member to re-verify on Discord with the new details", async () => {
  await handleRebindUid(
    member,
    "bitget",
    { chat: { id: 9 }, text: "222" } as any,
    now,
    deps(),
  );
  const text = mocks.send.mock.calls.at(-1)![1] as string;
  expect(text).toContain("已換綁為 Bitget UID 222");
  expect(text).toContain("付費期限保留");
  expect(text).toContain("Email：a@example.com");
});
