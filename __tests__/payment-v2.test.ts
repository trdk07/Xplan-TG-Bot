import { it, expect, vi, afterEach, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  send: vi.fn(),
  read: vi.fn(),
  lock: vi.fn(),
  photo: vi.fn(),
}));
vi.mock("@/lib/notion", () => ({
  updateMember: mocks.write,
  getMemberByPageId: mocks.read,
}));
vi.mock("@/lib/qualification", () => ({
  withQualificationLock: (id: string, work: any) => mocks.lock(id, work),
}));
vi.mock("@/lib/telegram", () => ({
  sendMessage: mocks.send,
  sendPhoto: mocks.photo,
}));
vi.mock("@/lib/config", () => ({
  getRuntimeConfig: () => ({
    paymentGraceDays: 3,
    appBaseUrl: "https://app.test",
  }),
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

it("shows a first-time plan with every payment method and the USDT QR code", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  const member = { pageId: "p", status: "free", reviewDueAt: null, paidAt: null };
  mocks.read.mockResolvedValue(member);
  await sendPaymentRequest(member as any, "123", new Date("2026-11-09"));
  const text = mocks.send.mock.calls[0][1] as string;
  expect(text).toContain("已開啟付費升級申請");
  expect(text).toContain("付費方案");
  expect(text).not.toContain("續費");
  for (const uid of ["3904055146", "606715251568316021", "21601021", "77242747"])
    expect(text).toContain(`<code>${uid}</code>`);
  expect(text).toContain("<code>0x3b91863cb0e71c37350c8de95fdf28a8f3cdd701</code>");
  expect(text).toContain("BEP20");
  expect(mocks.photo).toHaveBeenCalledWith(
    "123",
    "https://app.test/payment/usdt-bep20-qr.png",
    expect.stringContaining("0x3b91863cb0e71c37350c8de95fdf28a8f3cdd701"),
  );
});
it("labels a request from a current paid member as a renewal", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  const member = {
    pageId: "p",
    status: "active_paid",
    paidAt: "2026-10-01T00:00:00Z",
    reviewDueAt: "2026-12-01T00:00:00Z",
  };
  mocks.read.mockResolvedValue(member);
  await sendPaymentRequest(member as any, "123", new Date("2026-11-09"));
  expect(mocks.send.mock.calls[0][1]).toContain("續費方案");
});
it("re-shows payment details for an open request without resetting it", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  const member = {
    pageId: "p",
    status: "free",
    reviewDueAt: null,
    paidAt: null,
    renewalStep: "payment_pending",
    paymentDeadlineAt: "2026-11-12T00:00:00Z",
  };
  mocks.read.mockResolvedValue(member);
  await sendPaymentRequest(member as any, "123", new Date("2026-11-09"));
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.send.mock.calls[0][1]).toContain("付款方式");
  expect(mocks.photo).toHaveBeenCalled();
});
it("still sends the payment text when the QR image cannot be delivered", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  mocks.photo.mockRejectedValue(new Error("bad url"));
  const member = { pageId: "p", status: "free", reviewDueAt: null, paidAt: null };
  mocks.read.mockResolvedValue(member);
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(
    sendPaymentRequest(member as any, "123", new Date("2026-11-09")),
  ).resolves.toBeUndefined();
  expect(mocks.send.mock.calls[0][1]).toContain("付款方式");
});

it.each(["suspended", "kicked", "denied", "partner", "exempt", "VIP"])(
  "does not collect payment when the fresh membership became %s before the lease",
  async (status) => {
    vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
    const member = {
      pageId: "p",
      status: "free",
      paidAt: null,
      reviewDueAt: null,
    };
    mocks.read.mockResolvedValue({
      ...member,
      status,
      ...(["suspended", "kicked", "denied"].includes(status)
        ? {
            renewalStep: "payment_pending",
            paymentDeadlineAt: "2026-11-12T00:00:00Z",
            paymentProofFileId: "existing-partial-proof",
          }
        : {}),
    });

    await sendPaymentRequest(member as any, "123", new Date("2026-11-09"));

    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.photo).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      "123",
      ["partner", "exempt", "VIP"].includes(status)
        ? expect.stringContaining("不需要付費")
        : expect.not.stringContaining("付款方式"),
    );
  },
);

it.each([
  { status: "free", paidAt: null },
  { status: "active_paid", paidAt: null },
  { status: "active_paid", paidAt: "invalid" },
  { status: "active_paid", paidAt: "2099-01-01T00:00:00Z" },
])(
  "uses a three-day payment window when a future cutoff has no current paid evidence: %j",
  async (facts) => {
    vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
    const member = {
      pageId: "p",
      ...facts,
      reviewDueAt: "2099-01-01T00:00:00Z",
    };
    mocks.read.mockResolvedValue(member);

    await sendPaymentRequest(member as any, "123", new Date("2026-11-09"));

    expect(mocks.write).toHaveBeenCalledWith(
      "p",
      expect.objectContaining({ paymentDeadlineAt: "2026-11-12T00:00:00.000Z" }),
    );
    expect(mocks.write.mock.calls[0][1]).not.toHaveProperty("status");
  },
);

it("retains a current paid cutoff as the default renewal deadline", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  const member = {
    pageId: "p",
    status: "active_paid",
    paidAt: "2026-10-01T00:00:00Z",
    reviewDueAt: "2026-12-01T00:00:00Z",
  };
  mocks.read.mockResolvedValue(member);

  await sendPaymentRequest(member as any, "123", new Date("2026-11-09"));

  expect(mocks.write).toHaveBeenCalledWith(
    "p",
    expect.objectContaining({ paymentDeadlineAt: "2026-12-01T00:00:00.000Z" }),
  );
});

it("retains an explicit V2 payment deadline without current paid evidence", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
  const member = { pageId: "p", status: "free", paidAt: null, reviewDueAt: null };
  mocks.read.mockResolvedValue(member);

  await sendPaymentRequest(
    member as any,
    "123",
    new Date("2026-11-09"),
    new Date("2026-11-10T12:00:00Z"),
  );

  expect(mocks.write).toHaveBeenCalledWith(
    "p",
    expect.objectContaining({ paymentDeadlineAt: "2026-11-10T12:00:00.000Z" }),
  );
});

it("retains the V1 trial cutoff as its default payment deadline", async () => {
  vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "false");

  await sendPaymentRequest(
    { pageId: "p", status: "trial_active", paidAt: null, reviewDueAt: "2026-12-01T00:00:00Z" } as any,
    "123",
    new Date("2026-11-09"),
  );

  expect(mocks.write).toHaveBeenCalledWith(
    "p",
    expect.objectContaining({ paymentDeadlineAt: "2026-12-01T00:00:00.000Z" }),
  );
});
