import {
  BadgeCheck,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  FileWarning,
} from "lucide-react";
import { daysUntil, formatDateTime } from "@/lib/dates";
import type { Member } from "@/lib/notion";
import type { MemberStatus } from "@/lib/status";

export function statCount(members: Member[], statuses: MemberStatus[]) {
  return members.filter((member) => statuses.includes(member.status)).length;
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
      icon: BadgeCheck,
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
      icon: Clock3,
    } as const;
  }

  if (hasProof || hasUid) {
    return {
      tone: "warning",
      label: "待補件",
      detail: hasProof ? "缺 UID 末四碼" : "缺轉帳截圖",
      icon: FileWarning,
    } as const;
  }

  return {
    tone: "muted",
    label: "待付款資料",
    detail: "尚未收到截圖與 UID 末四碼",
    icon: Clock3,
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
        icon: Clock3,
      } as const;
    }

    if (member.renewalStep === "awaiting_pnl") {
      return {
        tone: "warning",
        label: "待回覆收益",
        detail: "等學員回覆合約收益狀況",
        icon: Clock3,
      } as const;
    }

    return {
      tone: "warning",
      label: "待選續留",
      detail: member.finalPnl
        ? "已回覆收益，等續留選擇"
        : "等學員選擇續費 / 不續留",
      icon: Clock3,
    } as const;
  }

  if (member.status === "payment_pending") {
    return {
      tone: "warning",
      label: "已申請續費",
      detail: "等付款資料或助理審核",
      icon: CircleDollarSign,
    } as const;
  }

  if (member.status === "active_paid") {
    return {
      tone: "success",
      label: "已續約有效",
      detail: member.reviewDueAt
        ? `有效期限：${formatDateTime(member.reviewDueAt)}`
        : "會籍有效",
      icon: BadgeCheck,
    } as const;
  }

  if (member.status === "trial_active") {
    if (days !== null && days >= 0 && days <= 7) {
      return {
        tone: "warning",
        label: member.renewalReminderSentAt ? "已提醒續約" : "即將到期",
        detail: dueText,
        icon: CalendarClock,
      } as const;
    }

    return {
      tone: "muted",
      label: "體驗進行中",
      detail: member.reviewDueAt
        ? `到期：${formatDateTime(member.reviewDueAt)}`
        : "尚無到期日",
      icon: CalendarClock,
    } as const;
  }

  if (member.kickReason === "user_declined_renewal") {
    return {
      tone: "danger",
      label: "不續留",
      detail: "學員已選擇暫時不續留",
      icon: FileWarning,
    } as const;
  }

  if (member.status === "expired") {
    return {
      tone: "danger",
      label: "逾期未完成",
      detail: member.kickReason || "續約或付款期限已過",
      icon: FileWarning,
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
      icon: BadgeCheck,
    } as const;
  }

  return null;
}
