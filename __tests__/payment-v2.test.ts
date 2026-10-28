import { it, expect, vi, afterEach, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  send: vi.fn(),
  read: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@/lib/notion", () => ({
  updateMember: mocks.write,
  getMemberByPageId: mocks.read,
}));
vi.mock("@/lib/qualification", () => ({
  withQualificationLock: (id: string, work: any) => mocks.lock(id, work),
}));
vi.mock("@/lib/telegram", () => ({ sendMessage: mocks.send }));
vi.mock("@/lib/config", () => ({
  getRuntimeConfig: () => ({ paymentGraceDays: 3 }),
}));
import {
  sendPaymentRequest,
  expirePaymentPendingMember,
  handlePaymentProofMessage,
} from "@/lib/bot/handlers/payment";
beforeEach(() => {
  mocks.lock.mockImplementation(async (_id: string, work: any) =>
    work(async () => {}),
  );
  mocks.read.mockResolvedValue({
    pageId: "p",
    status: "free",
    renewalStep: "payment_pending",
    paymentDeadlineAt: "2020-01-01",
    reviewDueAt: "2020-01-01",
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("does not replace volume tier when requesting payment", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  await sendPaymentRequest(
    { pageId: "p", status: "active_volume", reviewDueAt: "2020-01-01" } as any,
    "123",
    new Date("2026-10-28"),
  );
  expect(mocks.write.mock.calls[0][1]).not.toHaveProperty("status");
});
it("payment application expiration never writes expired membership in v2", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  await expirePaymentPendingMember(
    { pageId: "p", status: "free", reviewDueAt: "2020-01-01" } as any,
    "123",
    new Date("2026-10-28"),
  );
  expect(mocks.write.mock.calls[0][1]).not.toHaveProperty("status");
});
it("does not mutate a cycle while another qualification/payment writer holds the lease", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  mocks.lock.mockRejectedValue(new Error("qualification_in_progress"));
  await expect(
    sendPaymentRequest(
      { pageId: "p", status: "free" } as any,
      "123",
      new Date("2026-10-28"),
    ),
  ).rejects.toThrow("qualification_in_progress");
  expect(mocks.write).not.toHaveBeenCalled();
});
it("does not erase proof or expire a newer payment cycle from an old snapshot", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  mocks.read.mockResolvedValue({
    pageId: "p",
    status: "active_paid",
    renewalStep: "",
    paidAt: "2026-10-28",
    reviewDueAt: "2027-01-01",
  });
  await expirePaymentPendingMember(
    {
      pageId: "p",
      status: "free",
      renewalStep: "payment_pending",
      paymentDeadlineAt: "2020-01-01",
    } as any,
    "123",
    new Date("2026-10-28"),
  );
  expect(mocks.write).not.toHaveBeenCalled();
});
it("does not append proof after concurrent approval closed its request", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  mocks.read.mockResolvedValue({
    pageId: "p",
    status: "active_paid",
    renewalStep: "",
  });
  await handlePaymentProofMessage(
    { pageId: "p", status: "free", renewalStep: "payment_pending" } as any,
    { chat: { id: 123 }, text: "1234" } as any,
    new Date("2026-10-28"),
  );
  expect(mocks.write).not.toHaveBeenCalled();
});

it("rejects a stale explicit deadline when only the paid cutoff changed", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  mocks.read.mockResolvedValue({
    pageId: "p",
    status: "active_paid",
    renewalStep: "",
    paidAt: "2026-10-01",
    reviewDueAt: "2027-01-01",
  });
  await sendPaymentRequest(
    {
      pageId: "p",
      status: "active_paid",
      paidAt: "2026-10-01",
      reviewDueAt: "2026-11-01",
    } as any,
    "123",
    new Date("2026-10-28"),
    new Date("2026-11-01"),
  );
  expect(mocks.write).not.toHaveBeenCalled();
});
