import { describe, expect, it } from "vitest";
import {
  isInvitationPending,
  isPaymentIncomplete,
  isTrialExperience,
  matchesAdminView,
  memberRevenue,
  monthlyRevenue,
  renewalConversionRate,
  statCount,
} from "@/lib/admin-views";
import { type Member } from "@/lib/notion";

function member(overrides: Partial<Member> = {}): Member {
  return {
    pageId: "page-1",
    telegramUserId: "1001",
    telegramUsername: "@user",
    email: "user@example.com",
    status: "trial_active",
    tags: [],
    exchangeRegistered: true,
    exchangeName: "MEXC",
    exchangeUid: "UID-1",
    invitationEmailSent: false,
    uidSubmittedAt: null,
    inviteLink: null,
    inviteExpiresAt: null,
    groupJoinedAt: null,
    reviewDueAt: "2026-05-08T00:00:00.000Z",
    paymentDeadlineAt: null,
    paymentUidLast4: "",
    paymentProofFileId: "",
    paymentProofSubmittedAt: null,
    paidAt: null,
    subscriptionMonths: null,
    finalPnl: "",
    renewalStep: "",
    renewalReminderSentAt: null,
    lastBotCheckAt: null,
    lastBotMessage: "",
    kickReason: "",
    tradingView: "",
    ...overrides,
  };
}

describe("admin-views", () => {
  const now = new Date("2026-05-01T00:00:00.000Z");

  it("counts members matching a set of statuses", () => {
    const members = [
      member({ status: "trial_active" }),
      member({ status: "active_paid" }),
      member({ status: "expired" }),
    ];
    expect(statCount(members, ["trial_active", "active_paid"])).toBe(2);
  });

  it("identifies payment_pending members missing exactly one of proof/uid", () => {
    expect(
      isPaymentIncomplete(
        member({ status: "payment_pending", paymentProofFileId: "file" }),
      ),
    ).toBe(true);
    expect(
      isPaymentIncomplete(
        member({ status: "payment_pending", paymentUidLast4: "1234" }),
      ),
    ).toBe(true);
    expect(
      isPaymentIncomplete(
        member({
          status: "payment_pending",
          paymentProofFileId: "file",
          paymentUidLast4: "1234",
        }),
      ),
    ).toBe(false);
  });

  it("identifies invitation-pending members", () => {
    expect(
      isInvitationPending(member({ status: "eligible", email: "a@b.com" })),
    ).toBe(true);
    expect(
      isInvitationPending(
        member({ status: "eligible", email: "a@b.com", invitationEmailSent: true }),
      ),
    ).toBe(false);
    expect(
      isInvitationPending(member({ status: "eligible", email: "" })),
    ).toBe(false);
  });

  it("groups trial_active/sent_7day_survey/sent_3day_offer as trial experience", () => {
    expect(isTrialExperience(member({ status: "trial_active" }))).toBe(true);
    expect(isTrialExperience(member({ status: "sent_7day_survey" }))).toBe(true);
    expect(isTrialExperience(member({ status: "active_paid" }))).toBe(false);
  });

  it("matches admin views consistently with the underlying predicates", () => {
    const reviewReady = member({
      status: "payment_pending",
      paymentProofFileId: "file",
      paymentUidLast4: "1234",
    });
    expect(matchesAdminView(reviewReady, "payment_review_ready", now)).toBe(true);
    expect(matchesAdminView(reviewReady, "payment_incomplete", now)).toBe(false);
  });

  it("computes per-member revenue from subscriptionMonths", () => {
    expect(memberRevenue(member({ paidAt: null }))).toBe(0);
    expect(
      memberRevenue(member({ paidAt: "2026-05-01T00:00:00.000Z", subscriptionMonths: 1 })),
    ).toBe(50);
    expect(
      memberRevenue(member({ paidAt: "2026-05-01T00:00:00.000Z", subscriptionMonths: 3 })),
    ).toBe(100);
  });

  it("buckets revenue by month and keeps only the most recent N months", () => {
    const members = [
      member({ paidAt: "2026-03-15T00:00:00.000Z", subscriptionMonths: 1 }),
      member({ paidAt: "2026-03-20T00:00:00.000Z", subscriptionMonths: 3 }),
      member({ paidAt: "2026-04-01T00:00:00.000Z", subscriptionMonths: 1 }),
    ];
    expect(monthlyRevenue(members)).toEqual([
      { month: "2026-03", revenue: 150 },
      { month: "2026-04", revenue: 50 },
    ]);
    expect(monthlyRevenue(members, 1)).toEqual([{ month: "2026-04", revenue: 50 }]);
  });

  it("computes renewal conversion rate over convertible (non-exempt) members", () => {
    const members = [
      member({ status: "active_paid", paidAt: "2026-04-01T00:00:00.000Z" }),
      member({ status: "trial_active", paidAt: null }),
      member({ status: "partner", paidAt: null }),
    ];
    // partner is excluded from the convertible denominator: 1 paid / 2 convertible = 50%
    expect(renewalConversionRate(members)).toBe(50);
    expect(renewalConversionRate([])).toBe(0);
  });
});
