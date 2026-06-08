export const memberStatuses = [
  "eligible",
  "collecting_info",
  "invite_sent",
  "join_pending",
  "trial_active",
  "sent_7day_survey",
  "sent_3day_offer",
  "user_refused",
  "renewal_due",
  "payment_pending",
  "active_paid",
  "partner",
  "exempt",
  "VIP",
  "expired",
  "kicked",
  "denied",
] as const;

export type MemberStatus = (typeof memberStatuses)[number];

export const memberStatusLabels: Record<MemberStatus, string> = {
  eligible: "可入群",
  collecting_info: "收集中",
  invite_sent: "連結已發",
  join_pending: "等待入群",
  trial_active: "體驗中",
  sent_7day_survey: "問卷已發",
  sent_3day_offer: "通知已發",
  user_refused: "不續訂",
  renewal_due: "到期未回",
  payment_pending: "待付款",
  active_paid: "訂閱中",
  partner: "合作夥伴",
  exempt: "免費會員",
  VIP: "VIP",
  expired: "已離開",
  kicked: "已離開",
  denied: "已拒絕",
};

export const nonExpiringStatuses = new Set<MemberStatus>([
  "partner",
  "exempt",
  "VIP",
]);

export const activeGroupStatuses = new Set<MemberStatus>([
  "trial_active",
  "sent_7day_survey",
  "sent_3day_offer",
  "user_refused",
  "renewal_due",
  "payment_pending",
  "active_paid",
  "partner",
  "exempt",
  "VIP",
]);

// Statuses that represent an active membership period (used by Daily Job orders 4-6)
export const normalMembershipStatuses = new Set<MemberStatus>([
  "trial_active",
  "active_paid",
  "sent_7day_survey",
  "sent_3day_offer",
]);

export const blockedEntryStatuses = new Set<MemberStatus>([
  "expired",
  "kicked",
  "denied",
]);

export function isMemberStatus(value: string): value is MemberStatus {
  return memberStatuses.includes(value as MemberStatus);
}

// active_paid is intentionally excluded — use the mark-paid buttons instead,
// which also update reviewDueAt, paidAt, and notify the member via Bot.
export const manualOverrideStatuses = memberStatuses.filter(
  (s) => s !== "active_paid",
);

export function memberStatusLabel(status: MemberStatus): string {
  return memberStatusLabels[status];
}

export function badgeTone(status: MemberStatus): "ok" | "warn" | "danger" {
  if (
    status === "active_paid" ||
    status === "trial_active" ||
    status === "sent_7day_survey" ||
    status === "sent_3day_offer" ||
    nonExpiringStatuses.has(status)
  ) {
    return "ok";
  }
  if (status === "expired" || status === "kicked" || status === "denied") {
    return "danger";
  }
  return "warn";
}
