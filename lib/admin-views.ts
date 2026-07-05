import { daysUntil, formatDateTime } from "@/lib/dates";
import {
  isPaymentFollowupCandidate,
  isPaymentReviewReady,
  isRenewalNoticeCandidate,
} from "@/lib/member-state";
import type { Member } from "@/lib/notion";
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

export function isTrialExperience(member: Member): boolean {
  return (
    member.status === "trial_active" ||
    member.status === "sent_7day_survey" ||
    member.status === "sent_3day_offer"
  );
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
      return isTrialExperience(member);
    case "ending_soon":
      return isEndingSoon(member, now);
    case "invitation_pending":
      return isInvitationPending(member);
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

  if (member.status === "active_paid" || member.paidAt) {
    return {
      tone: "success",
      label: "已標記付款",
      detail: member.paidAt
        ? `付款時間：${formatDateTime(member.paidAt)}`
        : "會籍有效",
    } as const;
  }

  if (member.status !== "payment_pending") {
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

export function renewalReviewState(member: Member) {
  const days = daysUntil(member.reviewDueAt);
  const dueText =
    days === null
      ? "-"
      : days < 0
        ? `已逾期 ${Math.abs(days)} 天`
        : `剩 ${days} 天`;

  if (member.status === "renewal_due") {
    if (member.renewalStep === "awaiting_trial_result") {
      return {
        tone: "warning",
        label: "待選翻倉",
        detail: "等學員按翻倉成功 / 尚未成功",
      } as const;
    }

    if (member.renewalStep === "awaiting_pnl") {
      return {
        tone: "warning",
        label: "待回覆收益",
        detail: "等學員回覆合約收益狀況",
      } as const;
    }

    return {
      tone: "warning",
      label: "待選續留",
      detail: member.finalPnl
        ? "已回覆收益，等續留選擇"
        : "等學員選擇續費 / 不續留",
    } as const;
  }

  if (member.status === "payment_pending") {
    return {
      tone: "warning",
      label: "已申請續費",
      detail: "等付款資料或助理審核",
    } as const;
  }

  if (member.status === "active_paid") {
    return {
      tone: "success",
      label: "已續約有效",
      detail: member.reviewDueAt
        ? `有效期限：${formatDateTime(member.reviewDueAt)}`
        : "會籍有效",
    } as const;
  }

  if (member.status === "trial_active") {
    if (days !== null && days >= 0 && days <= 7) {
      return {
        tone: "warning",
        label: member.renewalReminderSentAt ? "已提醒續約" : "即將到期",
        detail: dueText,
      } as const;
    }

    return {
      tone: "muted",
      label: "體驗進行中",
      detail: member.reviewDueAt
        ? `到期：${formatDateTime(member.reviewDueAt)}`
        : "尚無到期日",
    } as const;
  }

  if (member.kickReason === "user_declined_renewal") {
    return {
      tone: "danger",
      label: "不續留",
      detail: "學員已選擇暫時不續留",
    } as const;
  }

  if (member.status === "expired") {
    return {
      tone: "danger",
      label: "逾期未完成",
      detail: member.kickReason || "續約或付款期限已過",
    } as const;
  }

  if (
    member.status === "partner" ||
    member.status === "exempt" ||
    member.status === "VIP"
  ) {
    return {
      tone: "success",
      label: "免續約",
      detail: "不進入續約到期流程",
    } as const;
  }

  return null;
}
