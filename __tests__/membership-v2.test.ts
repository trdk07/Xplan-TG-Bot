import { describe, it, expect } from "vitest";
import {
  admissionDecision,
  completedVolumeWindow,
  effectiveMembership,
  sumAmounts,
  volumeMeetsThreshold,
  normalizeExchange,
  migrationPreview,
} from "@/lib/membership-v2";

const now = new Date("2026-10-28T01:00:00Z");
const volume = {
  status: "active_volume",
  admissionVerifiedAt: "2026-08-01T00:00:00Z",
  volumeCheckedAt: "2026-10-27T01:00:00Z",
  volumeQualified: true,
};
describe("v2 independent membership facts", () => {
  it("uses exact 200000 threshold across spot plus contracts", () => {
    expect(volumeMeetsThreshold("99999.99", "100000")).toBe(false);
    expect(volumeMeetsThreshold("99999.99", "100000.01")).toBe(true);
    expect(sumAmounts(["0.1", "0.2", "99.7"])).toBe("100");
    expect(() => sumAmounts(["NaN"])).toThrow();
  });
  it("checks the 30 completed Taipei dates, never today's partial day", () => {
    expect(completedVolumeWindow(now)).toEqual({
      start: "2026-09-27T16:00:00.000Z",
      end: "2026-10-27T16:00:00.000Z",
    });
  });
  it("gives paid priority but retains volume eligibility after expiration", () => {
    expect(
      effectiveMembership(
        {
          ...volume,
          paidAt: "2026-10-01T00:00:00Z",
          reviewDueAt: "2026-11-01T00:00:00Z",
        },
        now,
      ),
    ).toBe("active_paid");
    expect(
      effectiveMembership(
        {
          ...volume,
          paidAt: "2026-09-01T00:00:00Z",
          reviewDueAt: now.toISOString(),
        },
        now,
      ),
    ).toBe("active_volume");
    expect(
      effectiveMembership({ ...volume, volumeQualified: false }, now),
    ).toBe("free");
  });
  it("honors explicit suspension and non-expiring special members", () => {
    expect(effectiveMembership({ ...volume, status: "suspended" }, now)).toBe(
      "suspended",
    );
    for (const status of ["partner", "exempt", "VIP"] as const)
      expect(
        effectiveMembership({ status, reviewDueAt: "2020-01-01" }, now),
      ).toBe(status);
  });
  it("does not grant volume from a flag without admission and successful check evidence", () => {
    expect(
      effectiveMembership(
        { status: "active_volume", volumeQualified: true },
        now,
      ),
    ).toBe("free");
    expect(
      effectiveMembership(
        { ...volume, volumeCheckError: "API unavailable" },
        now,
      ),
    ).toBe("active_volume");
  });
  it("does not infer paid access from ambiguous legacy labels and historical dates", () => {
    for (const status of [
      "trial_active",
      "payment_pending",
      "collecting_info",
      "unknown",
    ]) {
      expect(
        effectiveMembership(
          { status, paidAt: "2026-01-01", reviewDueAt: "2027-01-01" },
          now,
        ),
      ).toBe("free");
    }
  });
  it("accepts proven gross deposit lower bound and never undoes prior qualification", () => {
    expect(admissionDecision(null, true, "100", false)).toBe("verified");
    expect(admissionDecision(null, true, "99.99", false)).toBe("needs_review");
    expect(admissionDecision(null, true, "99.99", true)).toBe("not_qualified");
    expect(admissionDecision("2026-01-01", null, "0", false)).toBe("verified");
  });
  it("canonicalizes exchange names without merging account identities", () => {
    expect(normalizeExchange("Mexc（抹茶）")).toBe("mexc");
    expect(normalizeExchange("BitGet")).toBe("bitget");
    expect(normalizeExchange("BitMart")).toBe(null);
  });
  it("previews trial migration without turning a trial deadline into paid access", () => {
    expect(
      migrationPreview(
        { status: "trial_active", reviewDueAt: "2027-01-01" },
        now,
      ),
    ).toMatchObject({ status: "free", reviewDueAt: null });
    expect(
      migrationPreview(
        {
          status: "payment_pending",
          paidAt: "2026-10-01",
          reviewDueAt: "2027-01-01",
        },
        now,
      ).needsReview,
    ).toBe(true);
    expect(
      migrationPreview(
        { status: "active_paid", paidAt: "invalid", reviewDueAt: "2027-01-01" },
        now,
      ).needsReview,
    ).toBe(true);
    expect(
      migrationPreview(
        { status: "expired", paidAt: "2020-01-01", reviewDueAt: "2020-02-01" },
        now,
      ),
    ).toMatchObject({ status: "free", needsReview: false });
    expect(
      migrationPreview(
        { status: "free", onboardingStep: "collecting_info" },
        now,
      ).onboardingStep,
    ).toBe("collecting_info");
    expect(
      migrationPreview({ status: "custom_unknown" }, now).needsReview,
    ).toBe(true);
  });
});
