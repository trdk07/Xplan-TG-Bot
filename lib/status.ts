export const memberStatuses = [
  "eligible",
  "collecting_info",
  "join_pending",
  "trial_active",
  "payment_pending",
  "active_paid",
  "partner",
  "exempt",
  "VIP",
  "expired",
  "kicked",
  "denied",
] as const;

export const legacyMemberStatuses = ["invite_sent", "sent_7day_survey", "sent_3day_offer", "user_refused", "renewal_due"] as const;
export type CanonicalMemberStatus = (typeof memberStatuses)[number];
// Legacy values remain readable until records are safely migrated, but cannot be selected for new writes.
export type MemberStatus = CanonicalMemberStatus | (typeof legacyMemberStatuses)[number];
export function isReadableMemberStatus(value: unknown): value is MemberStatus {
  return typeof value === "string" && [...memberStatuses, ...legacyMemberStatuses].includes(value as MemberStatus);
}

export const memberStatusLabels: Record<MemberStatus, string> = {
  eligible: "可入群",
  collecting_info: "待驗證",
  invite_sent: "連結已發",
  join_pending: "待入群",
  trial_active: "體驗中",
  sent_7day_survey: "待確認會籍（舊 7 日紀錄）",
  sent_3day_offer: "待確認會籍（舊 3 日紀錄）",
  user_refused: "待確認會籍（舊不續訂）",
  renewal_due: "待確認會籍（舊到期紀錄）",
  payment_pending: "待付款",
  active_paid: "訂閱中",
  partner: "合作夥伴",
  exempt: "免費會員",
  VIP: "VIP",
  expired: "已到期",
  kicked: "已停用",
  denied: "拒絕加入",
};

export const nonExpiringStatuses = new Set<MemberStatus>([
  "partner",
  "exempt",
  "VIP",
]);

export const activeGroupStatuses = new Set<MemberStatus>([
  "trial_active",
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
]);

export const blockedEntryStatuses = new Set<MemberStatus>([
  "expired",
  "kicked",
  "denied",
]);

export function isMemberStatus(value: string): value is CanonicalMemberStatus {
  return memberStatuses.includes(value as CanonicalMemberStatus);
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
