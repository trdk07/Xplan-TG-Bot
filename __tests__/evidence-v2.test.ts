import { afterAll, beforeAll, it, expect } from "vitest";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { EvidenceStore } from "@/lib/evidence-store";
let runtime: Miniflare, store: EvidenceStore;
beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: "2026-04-29",
    d1Databases: ["DB"],
  });
  const db = await runtime.getD1Database("DB");
  const migration = await readFile(
    "migrations/0001_membership_evidence.sql",
    "utf8",
  );
  await db.batch(
    migration
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
  store = new EvidenceStore(db);
});
afterAll(async () => runtime?.dispose());
it("deduplicates deposits per exchange/account and excludes own-account transfers", async () => {
  const events = [
    {
      id: "deposit1",
      asset: "USDT",
      amount: "60",
      usdtAmount: "60",
      at: "2026-01-01",
      kind: "deposit" as const,
    },
    {
      id: "transfer1",
      asset: "USDT",
      amount: "100",
      usdtAmount: "100",
      at: "2026-01-01",
      kind: "own_transfer" as const,
    },
  ];
  await store.recordDeposits("bitget", "00123", events);
  await store.recordDeposits("bitget", "00123", events);
  await store.recordDeposits("okx", "00123", [
    { ...events[0], usdtAmount: "500" },
  ]);
  expect(await store.depositTotal("bitget", "00123")).toBe("60");
  await store.recordDeposits("bitget", "00123", [
    { ...events[0], id: "deposit2", usdtAmount: "40" },
  ]);
  expect(await store.depositTotal("bitget", "00123")).toBe("100");
});
it("makes only one notification claim across concurrent deliveries", async () => {
  let delivered = 0;
  await Promise.all([
    store.deliverOnce("member:due:7day", async () => {
      delivered++;
    }),
    store.deliverOnce("member:due:7day", async () => {
      delivered++;
    }),
  ]);
  expect(delivered).toBe(1);
  expect(
    await store.deliverOnce("member:due:7day", async () => {
      delivered++;
    }),
  ).toBe("already_sent");
});
it("holds unknown send outcome instead of blindly repeating", async () => {
  await expect(
    store.deliverOnce("member:due:3day", async () => {
      throw new Error("timeout");
    }),
  ).rejects.toThrow();
  let delivered = false;
  expect(
    await store.deliverOnce("member:due:3day", async () => {
      delivered = true;
    }),
  ).toBe("held");
  expect(delivered).toBe(false);
});
it("serializes per-member scans across independent store instances", async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  const first = store.withQualificationLock("member", async () => {
    entered();
    await held;
    return "first";
  });
  await started;
  await expect(
    store.withQualificationLock("member", async () => "second"),
  ).rejects.toThrow("qualification_in_progress");
  release();
  expect(await first).toBe("first");
  expect(
    await store.withQualificationLock("member", async () => "second"),
  ).toBe("second");
});
it("reserves an account atomically across different member resets", async () => {
  await store.reserveAccount("page1", "bitget", "777");
  await expect(
    store.reserveAccount("page2", "bitget", "777"),
  ).rejects.toThrow();
  await store.reserveAccount("page2", "okx", "777");
  await store.reserveAccount("page1", "bitget", "888");
  await store.reserveAccount("page3", "bitget", "777");
});
it("retains transition intent across repeated qualification and consumes it only once", async () => {
  const event = {
    key: "volume_upgrade:member:123",
    pageId: "MEM-BER",
    fromTier: "free",
    toTier: "active_volume",
    windowEnd: "2026-10-27",
    kind: "volume_upgrade" as const,
  };
  await store.recordTransition(event);
  await store.recordTransition(event);
  expect(await store.pendingTransitions("member")).toHaveLength(1);
  await store.completeTransition(event.key);
  expect(await store.pendingTransitions("member")).toHaveLength(0);
});
