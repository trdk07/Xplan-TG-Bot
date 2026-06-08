import { describe, expect, it } from "vitest";
import {
  isPaymentFollowupCandidate,
  isPaymentReviewReady,
  isRenewalNoticeCandidate,
} from "@/lib/member-state";
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

describe("member state helpers", () => {
  const now = new Date("2026-05-01T00:00:00.000Z");

  it("selects active members in the renewal window who have not started renewal", () => {
    expect(isRenewalNoticeCandidate(member(), now)).toBe(true);
    expect(
      isRenewalNoticeCandidate(member({ status: "active_paid" }), now),
    ).toBe(true);
  });

  it("skips renewal notices when already reminded unless manual resend allows it", () => {
    const alreadyReminded = member({
      renewalReminderSentAt: "2026-05-01T00:00:00.000Z",
    });

    expect(isRenewalNoticeCandidate(alreadyReminded, now)).toBe(false);
    expect(
      isRenewalNoticeCandidate(alreadyReminded, now, {
        allowAlreadyReminded: true,
      }),
    ).toBe(true);
  });

  it("skips members who already moved into another renewal or payment step", () => {
    expect(
      isRenewalNoticeCandidate(
        member({ status: "payment_pending", renewalStep: "payment_pending" }),
        now,
      ),
    ).toBe(false);
    expect(
      isRenewalNoticeCandidate(member({ renewalStep: "renewal_offer_sent" }), now),
    ).toBe(false);
  });

  it("selects payment follow-up candidates only when member action is incomplete", () => {
    expect(
      isPaymentFollowupCandidate(
        member({
          status: "payment_pending",
          renewalStep: "payment_pending",
          paymentDeadlineAt: "2026-05-04T00:00:00.000Z",
          paymentUidLast4: "1234",
        }),
        now,
      ),
    ).toBe(true);
    expect(
      isPaymentFollowupCandidate(
        member({
          status: "payment_pending",
          renewalStep: "payment_pending",
          paymentDeadlineAt: "2026-05-04T00:00:00.000Z",
          paymentUidLast4: "1234",
          paymentProofFileId: "proof-file",
        }),
        now,
      ),
    ).toBe(false);
  });

  it("keeps complete payment proof in admin review instead of user follow-up", () => {
    const ready = member({
      status: "payment_pending",
      renewalStep: "payment_pending",
      paymentDeadlineAt: "2026-05-04T00:00:00.000Z",
      paymentUidLast4: "1234",
      paymentProofFileId: "proof-file",
    });

    expect(isPaymentReviewReady(ready)).toBe(true);
    expect(isPaymentFollowupCandidate(ready, now)).toBe(false);
  });
});
