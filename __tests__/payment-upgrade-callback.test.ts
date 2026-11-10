import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  answer: vi.fn(),
  send: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@/lib/notion", () => ({
  findMemberByTelegramId: mocks.find,
  updateMember: vi.fn(),
}));
vi.mock("@/lib/telegram", () => ({
  answerCallbackQuery: mocks.answer,
  sendMessage: mocks.send,
  editMessageText: vi.fn(async () => undefined),
}));
vi.mock("@/lib/bot/handlers/payment", () => ({
  sendPaymentRequest: mocks.request,
  expirePaymentPendingMember: vi.fn(),
  hasSubmittedPaymentProof: () => false,
}));
vi.mock("@/lib/config", () => ({
  getRuntimeConfig: () => ({ teacherTelegramUid: "1", paymentGraceDays: 3 }),
}));
import { handleCallback } from "@/lib/bot/handlers/callback";

const now = new Date("2026-11-09T00:00:00Z");
const query = { id: "q", from: { id: 123 }, data: "payment:upgrade" } as any;
beforeEach(() => vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("opens a payment request for a free member", async () => {
  const member = { pageId: "p", status: "free" };
  mocks.find.mockResolvedValue(member);
  await handleCallback(query, now);
  expect(mocks.request).toHaveBeenCalledWith(member, 123, now);
});
it("does not ask special members to pay", async () => {
  mocks.find.mockResolvedValue({ pageId: "p", status: "partner" });
  await handleCallback(query, now);
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.answer).toHaveBeenCalledWith("q", expect.stringContaining("不需要付費"), true);
});
it("rejects suspended members", async () => {
  mocks.find.mockResolvedValue({ pageId: "p", status: "suspended" });
  await handleCallback(query, now);
  expect(mocks.request).not.toHaveBeenCalled();
});
