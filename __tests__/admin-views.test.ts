import { describe, expect, it } from "vitest";
import {
  isInvitationPending,
  paymentReviewState,
  renewalReviewState,
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
    renewalReminder3DaySentAt: null,
    renewalReminderDueAt: null,
    lastBotCheckAt: null,
    lastBotMessage: "",
    kickReason: "",
    tradingView: "",
    discordId: "",
    discordVerifiedAt: null,
    discordRole: null,
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

  it("does not classify ambiguous legacy reminders as active trial memberships", () => {
    expect(isTrialExperience(member({ status: "trial_active" }), now)).toBe(true);
    expect(isTrialExperience(member({ status: "sent_7day_survey" }), now)).toBe(false);
    expect(isTrialExperience(member({ status: "trial_active", reviewDueAt: "2026-04-01T00:00:00.000Z" }), now)).toBe(false);
    expect(isTrialExperience(member({ status: "active_paid" }), now)).toBe(false);
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


describe("current renewal review independent of old survey flow", () => {
  it("shows an expired member's new proof as awaiting review despite prior paidAt", () => {
    expect(paymentReviewState(member({ status: "expired", renewalStep: "payment_pending", paidAt: "2026-04-01T00:00:00.000Z", paymentUidLast4: "1234", paymentProofFileId: "proof" }))?.label).toBe("待審核");
  });

  it("does not mistake an expired payment request for a confirmed historical payment", () => {
    expect(paymentReviewState(member({ status: "payment_pending", renewalStep: "payment_expired", paidAt: "2026-04-01T00:00:00.000Z" }))?.label).toBe("付款期限已過");
  });

  it("does not display retired questionnaire steps as live tasks", () => {
    expect(renewalReviewState(member({ status: "renewal_due", renewalStep: "awaiting_pnl" }))?.label).not.toBe("待回覆收益");
  });
});


describe("membership filters reflect the effective term", () => {
  const now = new Date("2026-05-01T00:00:00.000Z");
  it("includes expired members awaiting new payment review in the payment view", () => {
    expect(matchesAdminView(member({ status: "expired", renewalStep: "payment_pending", paidAt: "2026-03-01T00:00:00.000Z", paymentUidLast4: "1234", paymentProofFileId: "proof" }), "payment_review_ready", now)).toBe(true);
  });
  it("classifies a past-due active_paid member as expired before the next job updates Status", () => {
    const item = member({ status: "active_paid", reviewDueAt: "2026-04-30T00:00:00.000Z" });
    expect(matchesAdminView(item, "membership_expired", now)).toBe(true);
    expect(matchesAdminView(item, "paid_active", now)).toBe(false);
  });
});
