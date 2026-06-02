import { daysUntil, isPast } from "@/lib/dates";
import { type Member } from "@/lib/notion";

export const RENEWAL_REMINDER_DAYS = 7;

type RenewalNoticeOptions = {
  allowAlreadyReminded?: boolean;
  requireTelegramUserId?: boolean;
};

export function isRenewalNoticeCandidate(
  member: Member,
  now = new Date(),
  options: RenewalNoticeOptions = {},
): boolean {
  const allowAlreadyReminded = options.allowAlreadyReminded ?? false;
  const requireTelegramUserId = options.requireTelegramUserId ?? true;

  if (requireTelegramUserId && !member.telegramUserId) return false;
  if (member.status !== "trial_active" && member.status !== "active_paid") {
    return false;
  }
  if (member.renewalStep) return false;
  if (!allowAlreadyReminded && member.renewalReminderSentAt) return false;

  const days = daysUntil(member.reviewDueAt, now);
  return days !== null && days >= 0 && days <= RENEWAL_REMINDER_DAYS;
}

export function isPaymentFollowupCandidate(
  member: Member,
  now = new Date(),
): boolean {
  if (!member.telegramUserId) return false;
  if (member.status !== "payment_pending") return false;
  if (member.paidAt) return false;
  if (isPast(member.paymentDeadlineAt, now)) return false;

  return !member.paymentProofFileId || !member.paymentUidLast4;
}

export function isPaymentReviewReady(member: Member): boolean {
  return Boolean(
    member.status === "payment_pending" &&
      member.paymentProofFileId &&
      member.paymentUidLast4 &&
      !member.paidAt,
  );
}
