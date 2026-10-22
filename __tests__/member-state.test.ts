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
      renewalReminderDueAt: "2026-05-08T00:00:00.000Z",
    });

    expect(isRenewalNoticeCandidate(alreadyReminded, now)).toBe(false);
    expect(
      isRenewalNoticeCandidate(alreadyReminded, now, {
        allowAlreadyReminded: true,
      }),
    ).toBe(true);
  });

  it("keeps reminder candidates while a future membership has entered payment", () => {
    expect(isRenewalNoticeCandidate(member({ status: "payment_pending", renewalStep: "payment_pending" }), now)).toBe(true);
    expect(isRenewalNoticeCandidate(member({ renewalStep: "renewal_offer_sent" }), now)).toBe(true);
  });

  it("separates the seven-day and three-day reminders by the current due-date cycle", () => {
    const item = member({ reviewDueAt: "2026-05-04T00:00:00.000Z", renewalReminderSentAt: "2026-04-27T00:00:00.000Z", renewalReminderDueAt: "2026-05-04T00:00:00.000Z" });
    expect(isRenewalNoticeCandidate(item, now)).toBe(false);
    expect(isRenewalNoticeCandidate(item, now, { stage: "3day" })).toBe(true);
    expect(isRenewalNoticeCandidate({ ...item, renewalReminder3DaySentAt: "2026-05-01T00:00:00.000Z" }, now, { stage: "3day" })).toBe(false);
    expect(isRenewalNoticeCandidate({ ...item, reviewDueAt: "2026-05-07T00:00:00.000Z" }, now)).toBe(true);
  });

  it("still sends the three-day reminder to an early-renewed legacy membership whose tier needs review", () => {
    const item = member({ status: "sent_7day_survey", paidAt: "2026-04-01T00:00:00.000Z", subscriptionMonths: 1, reviewDueAt: "2026-05-04T00:00:00.000Z" });
    expect(isRenewalNoticeCandidate(item, now, { stage: "3day" })).toBe(true);
    expect(item.status).toBe("sent_7day_survey");
  });

  it.each([
    ["sent_7day_survey", "7day"],
    ["sent_3day_offer", "3day"],
    ["sent_3day_offer", "7day"],
  ] as const)("treats legacy %s without a cycle marker as already sent for %s", (status, stage) => {
    const item = member({ status, groupJoinedAt: "2026-04-01T00:00:00.000Z", reviewDueAt: "2026-05-04T00:00:00.000Z" });
    expect(isRenewalNoticeCandidate(item, now, { stage })).toBe(false);
    expect(isRenewalNoticeCandidate(item, now, { stage, allowAlreadyReminded: true })).toBe(true);
    expect(isRenewalNoticeCandidate({ ...item, renewalReminderDueAt: "2026-04-04T00:00:00.000Z" }, now, { stage })).toBe(true);
  });

  it("never sends future-due reminders at or after the exact expiry time", () => {
    expect(isRenewalNoticeCandidate(member({ reviewDueAt: now.toISOString() }), now)).toBe(false);
    expect(isRenewalNoticeCandidate(member({ reviewDueAt: "2026-04-30T23:59:59.000Z" }), now)).toBe(false);
  });

  it("keeps a renewed payment awaiting review even when the member has historical paidAt", () => {
    expect(isPaymentReviewReady(member({ status: "expired", renewalStep: "payment_pending", paidAt: "2026-04-01T00:00:00.000Z", paymentUidLast4: "1234", paymentProofFileId: "proof" }))).toBe(true);
    expect(isPaymentFollowupCandidate(member({ status: "expired", renewalStep: "payment_pending", paidAt: "2026-04-01T00:00:00.000Z", paymentDeadlineAt: "2026-05-04T00:00:00.000Z" }), now)).toBe(true);
  });

  it("excludes expired payment windows even while membership status remains payment_pending", () => {
    const item = member({ status: "payment_pending", renewalStep: "payment_expired", paymentUidLast4: "1234", paymentProofFileId: "proof" });
    expect(isPaymentReviewReady(item)).toBe(false);
    expect(isPaymentFollowupCandidate({ ...item, paymentProofFileId: "" }, now)).toBe(false);
  });

  it("stops current payment review after a member declines renewal", () => {
    const item = member({ status: "payment_pending", renewalStep: "declined", paymentUidLast4: "1234", paymentProofFileId: "proof" });
    expect(isPaymentReviewReady(item)).toBe(false);
    expect(isPaymentFollowupCandidate({ ...item, paymentProofFileId: "" }, now)).toBe(false);
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
