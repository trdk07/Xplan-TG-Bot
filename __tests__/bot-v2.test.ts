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
import { handleV2Uid } from "@/lib/bot/v2";
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

afterEach(() => vi.unstubAllEnvs());
