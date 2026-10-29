import { afterAll, afterEach, beforeAll, it, expect, vi } from "vitest";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { EvidenceStore, type EvidenceDatabase } from "@/lib/evidence-store";
import { checkQualifications } from "@/lib/qualification";
let runtime: Miniflare, db: EvidenceDatabase;
beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: "2026-04-29",
    d1Databases: ["DB"],
  });
  db = await runtime.getD1Database("DB");
  const sql = await readFile("migrations/0001_membership_evidence.sql", "utf8");
  await db.batch(
    sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => runtime?.dispose());
it("serializes independent instances and cannot release a replacement owner's lease", async () => {
  let clock = Date.parse("2026-10-28T01:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const old = new EvidenceStore(db),
    replacement = new EvidenceStore(db),
    third = new EvidenceStore(db);
  let releaseOld!: () => void,
    releaseNew!: () => void,
    oldGuard!: () => Promise<void>,
    newGuard!: () => Promise<void>;
  let enteredOld!: () => void, enteredNew!: () => void;
  const oldStarted = new Promise<void>((r) => (enteredOld = r)),
    newStarted = new Promise<void>((r) => (enteredNew = r));
  const oldHeld = new Promise<void>((r) => (releaseOld = r)),
    newHeld = new Promise<void>((r) => (releaseNew = r));
  const first = old.withQualificationLock("cross-instance", async (guard) => {
    oldGuard = guard;
    enteredOld();
    await oldHeld;
  });
  await oldStarted;
  await expect(
    replacement.withQualificationLock("cross-instance", async () => {}),
  ).rejects.toThrow("qualification_in_progress");
  await oldGuard();
  clock += 600001;
  const second = replacement.withQualificationLock(
    "cross-instance",
    async (guard) => {
      newGuard = guard;
      enteredNew();
      await newHeld;
    },
  );
  await newStarted;
  await expect(oldGuard()).rejects.toThrow("qualification_lease_expired");
  releaseOld();
  await first;
  await expect(
    third.withQualificationLock("cross-instance", async () => {}),
  ).rejects.toThrow("qualification_in_progress");
  await newGuard();
  releaseNew();
  await second;
  expect(
    await third.withQualificationLock("cross-instance", async (guard) => {
      await guard();
      return "reacquired";
    }),
  ).toBe("reacquired");
});
it("rejects an expired lease even before another owner claims it", async () => {
  let clock = Date.parse("2026-10-28T01:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await expect(
    new EvidenceStore(db).withQualificationLock("expired", async (guard) => {
      clock += 600000;
      await guard();
    }),
  ).rejects.toThrow("qualification_lease_expired");
});
it("does not write authoritative Notion facts after the scan's real D1 lease expires", async () => {
  const now = new Date("2026-10-28T01:00:00Z");
  let clock = now.getTime();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const member = {
    pageId: "scan-expiry",
    status: "free",
    exchangeName: "Bitget",
    exchangeUid: "123",
    admissionVerifiedAt: "2026-01-01",
    qualificationFieldsAvailable: true,
  };
  const write = vi.fn(async () => {});
  await expect(
    checkQualifications(
      "scan-expiry",
      {
        read: async () => member,
        list: async () => [member],
        write,
        store: new EvidenceStore(db),
        client: {
          admission: async () => {
            throw Error("unexpected");
          },
          volume: async () => {
            clock += 600001;
            return { spot: "200000", futures: "0" };
          },
        },
      } as any,
      now,
    ),
  ).rejects.toThrow("qualification_lease_expired");
  expect(write).not.toHaveBeenCalled();
});
it("uses one lock for hyphenated and case-varied spellings of the same Notion page ID", async () => {
  const owner = new EvidenceStore(db),
    other = new EvidenceStore(db);
  const canonical = "00000000-0000-4000-8000-abcdef000001",
    variant = canonical.replaceAll("-", "").toUpperCase();
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    held = new Promise<void>((r) => (release = r));
  const first = owner.withQualificationLock(canonical, async () => {
    entered();
    await held;
  });
  await started;
  try {
    await expect(
      other.withQualificationLock(variant, async () => {}),
    ).rejects.toThrow("qualification_in_progress");
  } finally {
    release();
    await first;
  }
});
