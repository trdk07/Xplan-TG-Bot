import { beforeEach, afterEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  send: vi.fn(),
  approve: vi.fn(),
  decline: vi.fn(),
  revoke: vi.fn(),
  invite: vi.fn(),
  unban: vi.fn(),
  answer: vi.fn(),
  recheck: vi.fn(),
}));
vi.mock("@/lib/notion", () => ({
  findMemberByTelegramId: mocks.read,
  updateMember: mocks.write,
}));
vi.mock("@/lib/telegram", () => ({
  sendMessage: mocks.send,
  approveChatJoinRequest: mocks.approve,
  declineChatJoinRequest: mocks.decline,
  revokeChatInviteLink: mocks.revoke,
  createChatInviteLink: mocks.invite,
  unbanChatMember: mocks.unban,
  answerCallbackQuery: mocks.answer,
}));
vi.mock("@/lib/qualification", () => ({
  recheckQualifications: mocks.recheck,
}));
vi.mock("@/lib/config", () => ({
  getRuntimeConfig: () => ({ teacherTelegramUid: "1" }),
}));
vi.mock("@/lib/evidence-store", () => ({
  getEvidenceStore: async () => ({
    deliverOnce: async (_key: string, send: () => Promise<unknown>) => {
      await send();
      return "sent";
    },
  }),
}));
import {
  handleV2Exchange,
  handleV2RulesAck,
  handleV2Start,
  handleV2Uid,
} from "@/lib/bot/v2";
import { RULES_ACK_CALLBACK, discordGuideMessage } from "@/lib/bot/v2-messages";
import { createInviteForMember as createV2Invite } from "@/lib/bot/invite";
import { handleJoinRequest as handleV2Join } from "@/lib/bot/handlers/membership";
const now = new Date("2026-10-28T01:00:00Z");
const member = {
  pageId: "p",
  telegramUserId: "123",
  status: "free",
  exchangeName: "Bitget",
  exchangeUid: "001234",
  admissionVerifiedAt: "2026-01-01",
  inviteLink: "https://t.me/test",
  inviteExpiresAt: "2026-10-29",
  groupJoinedAt: null,
} as any;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  mocks.invite.mockResolvedValue({ invite_link: "https://t.me/new" });
  process.env.DISCORD_INVITE_URL = "https://discord.gg/example";
});
it("creates a short-lived invite without changing membership tier", async () => {
  await createV2Invite(member, 123, now);
  expect(mocks.write).toHaveBeenCalledWith(
    "p",
    expect.objectContaining({ onboardingStep: "join_pending" }),
  );
  expect(mocks.write.mock.calls[0][1]).not.toHaveProperty("status");
});
it("rejects unqualified first admission", async () => {
  await createV2Invite({ ...member, admissionVerifiedAt: null }, 123, now);
  expect(mocks.invite).not.toHaveBeenCalled();
});
it("approves identity-bound admission and sends Discord link without a trial deadline", async () => {
  mocks.read.mockResolvedValue(member);
  await handleV2Join(
    {
      chat: { id: 1 },
      from: { id: 123 },
      user_chat_id: 123,
      invite_link: { invite_link: member.inviteLink },
    } as any,
    now,
  );
  expect(mocks.approve).toHaveBeenCalledWith(123);
  expect(mocks.write).toHaveBeenCalledWith(
    "p",
    expect.objectContaining({ onboardingStep: "joined" }),
  );
  expect(mocks.write.mock.calls[0][1]).not.toHaveProperty("reviewDueAt");
  expect(mocks.send).toHaveBeenCalledWith(
    123,
    expect.stringContaining("discord.gg/example"),
  );
});
it("does not query an account different from the registration record", async () => {
  await handleV2Uid(member, { chat: { id: 123 }, text: "999999" } as any, now);
  expect(mocks.recheck).not.toHaveBeenCalled();
});

it("shows the admission rules before asking for an exchange", async () => {
  await handleV2Start(
    { ...member, admissionVerifiedAt: null, inviteLink: null },
    { chat: { id: 123 } } as any,
    now,
  );
  const [, text, keyboard] = mocks.send.mock.calls[0];
  expect(text).toContain("100 USDT");
  expect(text).toContain("提領或轉走都不影響資格");
  expect(text).toContain("200,000 USDT");
  expect(keyboard[0][0]).toMatchObject({ callback_data: RULES_ACK_CALLBACK });
});
it("asks for the exchange only after the rules are acknowledged", async () => {
  await handleV2RulesAck(
    { id: "q", from: { id: 123 } } as any,
    { ...member, admissionVerifiedAt: null, inviteLink: null },
    now,
  );
  const [, text, keyboard] = mocks.send.mock.calls[0];
  expect(text).toContain("步驟 1／2");
  expect(keyboard[0].map((b: any) => b.callback_data)).toEqual([
    "exchange:confirm:mexc",
    "exchange:confirm:bitget",
    "exchange:confirm:okx",
  ]);
  expect(mocks.invite).not.toHaveBeenCalled();
});
it("does not restart onboarding for a blocked member", async () => {
  await handleV2RulesAck(
    { id: "q", from: { id: 123 } } as any,
    { ...member, status: "suspended" },
    now,
  );
  expect(mocks.answer).toHaveBeenCalledWith("q", expect.any(String), true);
  expect(mocks.send).not.toHaveBeenCalled();
});
it("explains where to find the UID after the exchange is confirmed", async () => {
  await handleV2Exchange(
    { id: "q", from: { id: 123 }, data: "exchange:confirm:bitget" } as any,
    member,
  );
  expect(mocks.send).toHaveBeenCalledWith(
    123,
    expect.stringContaining("UID 在哪裡"),
  );
});
it("tells the member which details the Discord form will ask for", () => {
  const text = discordGuideMessage(
    { ...member, email: "a&b@example.com" },
    "intro",
  );
  expect(text).toContain("discord.gg/example");
  expect(text).toContain("探索者");
  expect(text).toContain("交易所：Bitget");
  expect(text).toContain("UID：001234");
  expect(text).toContain("Email：a&amp;b@example.com");
});

afterEach(() => vi.unstubAllEnvs());
