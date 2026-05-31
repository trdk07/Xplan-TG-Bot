export const memberStatuses = [
  "eligible",
  "collecting_info",
  "invite_sent",
  "join_pending",
  "trial_active",
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
  invite_sent: "已發連結",
  join_pending: "等待入群",
  trial_active: "體驗中",
  renewal_due: "待續留確認",
  payment_pending: "待付款",
  active_paid: "已付款有效",
  partner: "合作夥伴",
  exempt: "免付款",
  VIP: "VIP",
  expired: "已過期",
  kicked: "已踢出",
  denied: "已拒絕",
};

export const nonExpiringStatuses = new Set<MemberStatus>([
  "partner",
  "exempt",
  "VIP",
]);

export const activeGroupStatuses = new Set<MemberStatus>([
  "trial_active",
  "renewal_due",
  "payment_pending",
  "active_paid",
  "partner",
  "exempt",
  "VIP",
]);

export const blockedEntryStatuses = new Set<MemberStatus>([
  "expired",
  "kicked",
  "denied",
]);

export function isMemberStatus(value: string): value is MemberStatus {
  return memberStatuses.includes(value as MemberStatus);
}

// Statuses available in the manual override dropdown.
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
    nonExpiringStatuses.has(status)
  ) {
    return "ok";
  }
  if (status === "expired" || status === "kicked" || status === "denied") {
    return "danger";
  }
  return "warn";
}
