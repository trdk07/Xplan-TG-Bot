import {
  v2Enabled,
  effectiveMembership,
  currentPaidFacts,
} from "@/lib/membership-v2";
import { daysUntil, isPast } from "@/lib/dates";
import {
  hasCurrentMembership,
  resolveLegacyStatus,
} from "@/lib/membership-policy";
import { type Member } from "@/lib/notion";
import { nonExpiringStatuses } from "@/lib/status";

export const RENEWAL_REMINDER_DAYS = 7;
export type RenewalReminderStage = "7day" | "3day";

type RenewalNoticeOptions = {
  allowAlreadyReminded?: boolean;
  requireTelegramUserId?: boolean;
  stage?: RenewalReminderStage;
};

export function isRenewalNoticeCandidate(
  member: Member,
  now = new Date(),
  options: RenewalNoticeOptions = {},
): boolean {
  const {
    allowAlreadyReminded = false,
    requireTelegramUserId = true,
    stage = "7day",
  } = options;
  if (requireTelegramUserId && !member.telegramUserId) return false;
  if (v2Enabled() && effectiveMembership(member, now) !== "active_paid")
    return false;
  // Sending an expiry reminder needs a valid term, not a guessed trial/paid tier.
  if (
    nonExpiringStatuses.has(member.status) ||
    !hasCurrentMembership(member, now)
  )
    return false;

  const dueAt = member.reviewDueAt ? Date.parse(member.reviewDueAt) : NaN;
  if (!Number.isFinite(dueAt) || dueAt <= now.getTime()) return false;
  const days = daysUntil(member.reviewDueAt, now);
  if (days === null || days > (stage === "3day" ? 3 : RENEWAL_REMINDER_DAYS))
    return false;

  const sameCycle =
    Boolean(member.renewalReminderDueAt) &&
    Date.parse(member.renewalReminderDueAt!) === dueAt;
  const reminded =
    stage === "3day"
      ? member.renewalReminder3DaySentAt
      : member.renewalReminderSentAt || member.renewalReminder3DaySentAt;
  const legacyAlreadySent =
    !member.renewalReminderDueAt &&
    (member.status === "sent_3day_offer" ||
      (stage === "7day" && member.status === "sent_7day_survey"));
  return (
    allowAlreadyReminded || (!legacyAlreadySent && (!sameCycle || !reminded))
  );
}

/** Current payment intent is independent of historical Paid At and membership expiry. */
export function isPaymentPending(member: Member): boolean {
  return (
    !["payment_expired", "declined"].includes(member.renewalStep) &&
    (member.renewalStep === "payment_pending" ||
      member.status === "payment_pending")
  );
}

export function isPaymentFollowupCandidate(
  member: Member,
  now = new Date(),
): boolean {
  if (!member.telegramUserId || !isPaymentPending(member)) return false;
  if (isPast(member.paymentDeadlineAt, now)) return false;
  return !member.paymentProofFileId || !member.paymentUidLast4;
}

export function isPaymentReviewReady(member: Member): boolean {
  return Boolean(
    isPaymentPending(member) &&
      member.paymentProofFileId &&
      member.paymentUidLast4,
  );
}

export function getMembershipState(member: Member, now = new Date()) {
  if (v2Enabled()) {
    const tier = effectiveMembership(member, now);
    if (tier === "suspended")
      return {
        state: "inactive",
        tone: "danger",
        label: "會員權益停用",
      } as const;
    if (tier === "free")
      return {
        state: "active",
        tone: "muted",
        label: "免費資格（無期限）",
      } as const;
    if (tier === "active_volume")
      return { state: "active", tone: "success", label: "交易量會員" } as const;
    return {
      state: "active",
      tone: "success",
      label: tier === "active_paid" ? "付費資格有效" : "特殊資格（免續約）",
    } as const;
  }
  const resolved = resolveLegacyStatus(member, now);
  if (resolved.needsReview)
    return { state: "review", tone: "warning", label: "會籍待確認" } as const;
  const status = resolved.status;
  if (status === "kicked" || status === "denied")
    return { state: "inactive", tone: "danger", label: "會籍已停用" } as const;
  if (nonExpiringStatuses.has(status))
    return {
      state: "active",
      tone: "success",
      label: "會籍有效（免續約）",
    } as const;
  if (status === "expired" || isPast(member.reviewDueAt, now))
    return { state: "expired", tone: "danger", label: "會籍已到期" } as const;
  if (["trial_active", "active_paid", "payment_pending"].includes(status)) {
    if (!member.reviewDueAt || !Number.isFinite(Date.parse(member.reviewDueAt)))
      return { state: "review", tone: "warning", label: "會籍待確認" } as const;
    return { state: "active", tone: "success", label: "會籍有效" } as const;
  }
  return { state: "pending", tone: "muted", label: "會籍尚未啟用" } as const;
}
