import { it, expect, vi } from "vitest";
import { checkQualifications } from "@/lib/qualification";
const now = new Date("2026-10-28T01:00:00Z");
const member = {
  pageId: "p",
  status: "free",
  exchangeName: "Bitget",
  exchangeUid: "123",
  admissionVerifiedAt: null,
  verifiedDepositUsdt: null,
  qualificationFieldsAvailable: true,
};
function dependencies(overrides: Record<string, unknown> = {}) {
  const current = { ...member, ...overrides } as any;
  return {
    read: vi.fn(async () => current),
    list: vi.fn(async () => [current]),
    write: vi.fn(async (_id: string, _patch: unknown) => {}),
    store: {
      recordTransition: vi.fn(async (_event: unknown) => {}),
      reserveAccount: async () => {},
      withQualificationLock: async (_id: string, work: any) =>
        work(async () => {}),
      recordDeposits: vi.fn(async () => {}),
      depositTotal: vi.fn(async () => "100"),
    },
    client: {
      admission: vi.fn(async () => ({
        referral: true,
        cumulative: "0",
        complete: false,
        events: [],
      })),
      volume: vi.fn(async () => ({ spot: "100000", futures: "100000" })),
    },
  };
}
it("qualifies admission from cumulative evidence and independent 200k volume", async () => {
  const d = dependencies();
  expect(await checkQualifications("p", d as any, now)).toMatchObject({
    status: "active_volume",
    volumeQualified: true,
    admissionVerifiedAt: now.toISOString(),
  });
  expect(d.write).toHaveBeenCalledWith(
    "p",
    expect.not.objectContaining({ discordRole: expect.anything() }),
  );
});
it("retains previous volume qualification on provider failure without a new timestamp", async () => {
  const d = dependencies({
    status: "active_volume",
    admissionVerifiedAt: "2026-01-01",
    volumeQualified: true,
    volumeCheckedAt: "2026-10-20",
  });
  d.client.volume.mockRejectedValue(new Error("upstream_unavailable"));
  const result = await checkQualifications("p", d as any, now);
  expect(result.status).toBe("active_volume");
  expect(result.volumeCheckedAt).toBe("2026-10-20");
  expect(d.write.mock.calls[0][1]).not.toHaveProperty("volumeQualified");
});
it("uses a fresh paid approval after network work instead of overwriting it", async () => {
  const d = dependencies();
  d.read.mockResolvedValueOnce(member as any).mockResolvedValueOnce({
    ...member,
    paidAt: "2026-10-28T00:00:00Z",
    reviewDueAt: "2026-11-28T00:00:00Z",
  } as any);
  expect((await checkQualifications("p", d as any, now)).status).toBe(
    "active_paid",
  );
  expect(d.write.mock.calls[0][1]).not.toHaveProperty("paidAt");
});
it("does not write results to a replaced account", async () => {
  const d = dependencies();
  d.read
    .mockResolvedValueOnce(member as any)
    .mockResolvedValueOnce({ ...member, exchangeUid: "456" } as any);
  await expect(checkQualifications("p", d as any, now)).rejects.toThrow(
    "account_changed",
  );
  expect(d.write).not.toHaveBeenCalled();
});
it("reports incomplete history below100 for human review", async () => {
  const d = dependencies();
  d.store.depositTotal.mockResolvedValue("99.99");
  expect(await checkQualifications("p", d as any, now)).toMatchObject({
    onboardingStep: "needs_review",
    status: "free",
  });
  expect(d.client.volume).not.toHaveBeenCalled();
  expect(d.write).toHaveBeenCalledWith(
    "p",
    expect.objectContaining({ exchangeRegistered: true }),
  );
});
it("discards an old scan when a newer successful result already exists", async () => {
  const d = dependencies();
  d.read.mockResolvedValueOnce(member as any).mockResolvedValueOnce({
    ...member,
    volumeQualified: false,
    volumeCheckedAt: "2026-10-29T01:00:00Z",
    qualificationCheckedAt: "2026-10-29T01:00:00Z",
  } as any);
  const result = await checkQualifications("p", d as any, now);
  expect(result.volumeQualified).toBe(false);
  expect(d.write).not.toHaveBeenCalled();
});
it("rejects a scan when admission was reset during network work", async () => {
  const d = dependencies({ admissionVerifiedAt: "2026-01-01" });
  d.read
    .mockResolvedValueOnce({
      ...member,
      admissionVerifiedAt: "2026-01-01",
    } as any)
    .mockResolvedValueOnce(member as any);
  await expect(checkQualifications("p", d as any, now)).rejects.toThrow(
    "admission_reset",
  );
  expect(d.write).not.toHaveBeenCalled();
});
it("rejects duplicate Notion account matches on direct recheck before making an API grant", async () => {
  const d = dependencies();
  d.list.mockResolvedValue([member, { ...member, pageId: "other" }] as any);
  await expect(checkQualifications("p", d as any, now)).rejects.toThrow(
    "duplicate_account",
  );
  expect(d.client.admission).not.toHaveBeenCalled();
  expect(d.write).not.toHaveBeenCalled();
});
it("persists transition intent before a Notion write that may fail", async () => {
  const d = dependencies();
  d.write.mockRejectedValue(new Error("Notion response lost"));
  await expect(checkQualifications("p", d as any, now)).rejects.toThrow(
    "Notion response lost",
  );
  expect(d.store.recordTransition).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "volume_upgrade",
      fromTier: "free",
      toTier: "active_volume",
      windowEnd: "2026-10-27T16:00:00.000Z",
    }),
  );
  expect(d.store.recordTransition.mock.invocationCallOrder[0]).toBeLessThan(
    d.write.mock.invocationCallOrder[0],
  );
});
