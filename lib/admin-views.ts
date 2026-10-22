import { daysUntil, formatDateTime } from "@/lib/dates";
import {
  getMembershipState,
  isPaymentPending,
  isPaymentFollowupCandidate,
  isPaymentReviewReady,
  isRenewalNoticeCandidate,
} from "@/lib/member-state";
import type { Member } from "@/lib/notion";
import { resolveLegacyStatus } from "@/lib/membership-policy";
import { nonExpiringStatuses, type MemberStatus } from "@/lib/status";

export function statCount(members: Member[], statuses: MemberStatus[]) {
  return members.filter((member) => statuses.includes(member.status)).length;
}

/** The 50U/100U pricing lives here alongside the other revenue helpers — see also AdminToolPanels' plan copy. */
export function memberRevenue(member: Member): number {
  if (!member.paidAt) return 0;
  if (member.subscriptionMonths === 1) return 50;
  if (member.subscriptionMonths === 3) return 100;
  return 0;
}

export type MonthlyRevenue = { month: string; revenue: number };

export function monthlyRevenue(
  members: Member[],
  monthsBack = 12,
): MonthlyRevenue[] {
  const totals = new Map<string, number>();
  for (const member of members) {
    if (!member.paidAt) continue;
    const month = member.paidAt.slice(0, 7);
    totals.set(month, (totals.get(month) || 0) + memberRevenue(member));
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-monthsBack)
    .map(([month, revenue]) => ({ month, revenue }));
}

/** Convertible = ever subject to the trial→paid decision (excludes partner/exempt/VIP). */
export function renewalConversionRate(members: Member[]): number {
  const convertible = members.filter((m) => !nonExpiringStatuses.has(m.status));
  if (!convertible.length) return 0;
  const converted = convertible.filter((m) => Boolean(m.paidAt));
  return Math.round((converted.length / convertible.length) * 100);
}

export function isPaymentIncomplete(member: Member): boolean {
  return paymentReviewState(member)?.label === "待補件";
}

export function isInvitationPending(member: Member): boolean {
  return (
    member.status === "eligible" &&
    Boolean(member.email) &&
    !member.invitationEmailSent
  );
}

export function isTrialExperience(member: Member, now = new Date()): boolean {
  return resolveLegacyStatus(member, now).status === "trial_active" && getMembershipState(member, now).state === "active";
}

export function isEndingSoon(member: Member, now: Date): boolean {
  return (
    isRenewalNoticeCandidate(member, now, { allowAlreadyReminded: true }) ||
    isPaymentFollowupCandidate(member, now)
  );
}

/**
 * Named list views whose member-count must always match the number of
 * members returned when filtering by that view — the stat cards on the
 * dashboard link straight into these instead of a raw status filter, so
 * the number on the card and the number in the resulting list can never
 * drift apart.
 */
export const adminViews = [
  "payment_review_ready",
  "payment_incomplete",
  "trial_experience",
  "ending_soon",
  "invitation_pending",
  "payment_pending",
  "paid_active",
  "membership_expired",
] as const;

export type AdminView = (typeof adminViews)[number];

export function isAdminView(value: string): value is AdminView {
  return (adminViews as readonly string[]).includes(value);
}

export function matchesAdminView(
  member: Member,
  view: AdminView,
  now: Date,
): boolean {
  switch (view) {
    case "payment_review_ready":
      return isPaymentReviewReady(member);
    case "payment_incomplete":
      return isPaymentIncomplete(member);
    case "trial_experience":
      return isTrialExperience(member, now);
    case "ending_soon":
      return isEndingSoon(member, now);
    case "invitation_pending":
      return isInvitationPending(member);
    case "payment_pending":
      return isPaymentPending(member);
    case "paid_active":
      return resolveLegacyStatus(member, now).status === "active_paid" && getMembershipState(member, now).state === "active";
    case "membership_expired":
      return getMembershipState(member, now).state === "expired";
  }
}

export function isLegacyBitMartMember(member: Member) {
  return member.exchangeName.trim().toLowerCase().includes("bitmart");
}

export function legacyBitMartReviewNote(member: Member) {
  return isLegacyBitMartMember(member)
    ? "舊 BitMart 會員，續費請用 MEXC 收款紀錄核對"
    : "";
}

export function paymentReviewState(member: Member) {
  const hasProof = Boolean(member.paymentProofFileId);
  const hasUid = Boolean(member.paymentUidLast4);

  if (member.renewalStep === "payment_expired") {
    return { tone: "warning", label: "付款期限已過", detail: "需重新申請付款；會籍依原到期日判斷" } as const;
  }
  if (!isPaymentPending(member)) {
    if (member.status === "active_paid" || member.paidAt) {
      return {
        tone: "success",
        label: "已標記付款",
        detail: member.paidAt ? `上次付款：${formatDateTime(member.paidAt)}` : "會籍有效",
      } as const;
    }
    return null;
  }

  if (hasProof && hasUid) {
    return {
      tone: "warning",
      label: "待審核",
      detail: `UID 末四碼：${member.paymentUidLast4}`,
    } as const;
  }

  if (hasProof || hasUid) {
    return {
      tone: "warning",
      label: "待補件",
      detail: hasProof ? "缺 UID 末四碼" : "缺轉帳截圖",
    } as const;
  }

  return {
    tone: "muted",
    label: "待付款資料",
    detail: "尚未收到截圖與 UID 末四碼",
  } as const;
}

export function renewalReviewState(member: Member, now = new Date()) {
  const membership = getMembershipState(member, now);
  if (membership.state === "review") {
    return { tone: "warning", label: "會籍待確認", detail: "舊狀態或期限資料不足，請助理確認" } as const;
  }
  if (membership.state === "expired" || membership.state === "inactive") {
    return { tone: "danger", label: membership.label, detail: "Telegram 群組資格保留，付費權益依會籍處理" } as const;
  }
  if (nonExpiringStatuses.has(member.status)) {
    return { tone: "success", label: "免續約", detail: "不進入續約到期流程" } as const;
  }
  if (isPaymentPending(member)) {
    return { tone: "warning", label: "已申請續費", detail: "等付款資料或助理審核，會籍仍依原期限" } as const;
  }
  if (membership.state !== "active") return null;

  const days = daysUntil(member.reviewDueAt, now);
  const sameCycle = Boolean(member.renewalReminderDueAt && member.reviewDueAt)
    && Date.parse(member.renewalReminderDueAt!) === Date.parse(member.reviewDueAt!);
  if (days !== null && days <= 7) {
    return {
      tone: "warning",
      label: sameCycle && (member.renewalReminderSentAt || member.renewalReminder3DaySentAt) ? "已提醒續約" : "即將到期",
      detail: `剩 ${days} 天；提醒不變更會籍`,
    } as const;
  }
  return {
    tone: "success",
    label: resolveLegacyStatus(member, now).status === "trial_active" ? "體驗進行中" : "訂閱有效",
    detail: `有效期限：${formatDateTime(member.reviewDueAt)}`,
  } as const;
}
