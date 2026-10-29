/** V2 business facts. This module never performs network I/O or writes evidence. */
export const v2Statuses = [
  "free",
  "active_volume",
  "active_paid",
  "partner",
  "exempt",
  "VIP",
  "suspended",
] as const;
export type V2Status = (typeof v2Statuses)[number];
export type Exchange = "mexc" | "bitget" | "okx";
export const VOLUME_THRESHOLD_USDT = "200000";
export const MINIMUM_DEPOSIT_USDT = "100";
export const v2Enabled = () =>
  process.env.MEMBERSHIP_POLICY_V2_ENABLED === "true";
export function normalizeExchange(input: string): Exchange | null {
  const value = input.trim().toLowerCase();
  if (["mexc", "mexc（抹茶）", "mexc(抹茶)", "抹茶"].includes(value))
    return "mexc";
  return value === "bitget" || value === "okx" ? value : null;
}
export const exchangeLabel = (exchange: Exchange) =>
  ({ mexc: "MEXC", bitget: "Bitget", okx: "OKX" })[exchange];
function decimals(values: string[]) {
  if (
    values.some(
      (value) => value.length > 120 || !/^\d+(?:\.\d{1,36})?$/.test(value),
    )
  )
    throw new Error("Invalid non-negative decimal amount");
  const scale = Math.max(
    0,
    ...values.map((value) => value.split(".")[1]?.length || 0),
  );
  const units = values.map((value) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt(whole + fraction.padEnd(scale, "0"));
  });
  return { scale, units };
}
export function sumAmounts(values: string[]): string {
  const { scale, units } = decimals(values);
  const sum = units
    .reduce((a, b) => a + b, 0n)
    .toString()
    .padStart(scale + 1, "0");
  return scale
    ? `${sum.slice(0, -scale)}.${sum.slice(-scale)}`.replace(/\.?0+$/, "") ||
        "0"
    : sum;
}
export function amountAtLeast(value: string, minimum: string): boolean {
  const { units } = decimals([value, minimum]);
  return units[0] >= units[1];
}
export function volumeMeetsThreshold(spot: string, futures: string) {
  return amountAtLeast(sumAmounts([spot, futures]), VOLUME_THRESHOLD_USDT);
}
export function completedVolumeWindow(now = new Date()): {
  start: string;
  end: string;
} {
  const day = 86400000,
    offset = 8 * 3600000;
  const end = Math.floor((now.getTime() + offset) / day) * day - offset;
  return {
    start: new Date(end - 30 * day).toISOString(),
    end: new Date(end).toISOString(),
  };
}
export type MembershipFacts = {
  status: string;
  paidAt?: string | null;
  reviewDueAt?: string | null;
  admissionVerifiedAt?: string | null;
  volumeQualified?: boolean;
  volumeCheckedAt?: string | null;
  volumeCheckError?: string;
};
export function validPastDate(value: string | null | undefined, now: Date) {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) && t <= now.getTime();
}
export function currentPaidFacts(member: MembershipFacts, now = new Date()) {
  const due = member.reviewDueAt ? Date.parse(member.reviewDueAt) : NaN;
  return (
    validPastDate(member.paidAt, now) &&
    Number.isFinite(due) &&
    due > now.getTime() &&
    Date.parse(member.paidAt!) < due
  );
}
export function effectiveMembership(
  member: MembershipFacts,
  now = new Date(),
): V2Status {
  if (["suspended", "kicked", "denied"].includes(member.status))
    return "suspended";
  if (["partner", "exempt", "VIP"].includes(member.status))
    return member.status as V2Status;
  if (!["free", "active_volume", "active_paid"].includes(member.status))
    return "free";
  if (currentPaidFacts(member, now)) return "active_paid";
  if (
    member.volumeQualified &&
    validPastDate(member.admissionVerifiedAt, now) &&
    validPastDate(member.volumeCheckedAt, now)
  )
    return "active_volume";
  return "free";
}
export function admissionDecision(
  previous: string | null | undefined,
  referral: boolean | null,
  proven: string,
  complete: boolean,
) {
  if (previous) return "verified";
  if (referral === null) return "needs_review";
  if (!referral) return "not_qualified";
  if (amountAtLeast(proven, MINIMUM_DEPOSIT_USDT)) return "verified";
  return complete ? "not_qualified" : "needs_review";
}
export function migrationPreview(
  member: MembershipFacts & {
    groupJoinedAt?: string | null;
    renewalStep?: string;
    onboardingStep?: string;
  },
  now = new Date(),
) {
  const legacy = !v2Statuses.includes(member.status as V2Status);
  const due = member.reviewDueAt ? Date.parse(member.reviewDueAt) : NaN;
  const known = [
    ...v2Statuses,
    "eligible",
    "collecting_info",
    "join_pending",
    "trial_active",
    "payment_pending",
    "expired",
    "kicked",
    "denied",
    "invite_sent",
    "sent_7day_survey",
    "sent_3day_offer",
    "user_refused",
    "renewal_due",
  ];
  const ambiguous =
    !known.includes(member.status as any) ||
    (legacy &&
      Boolean(member.paidAt) &&
      !["active_paid", "kicked", "denied"].includes(member.status) &&
      (!Number.isFinite(due) || due > now.getTime()));
  const dropTrialDate = member.status === "trial_active" && !member.paidAt;
  return {
    status: effectiveMembership(
      { ...member, ...(dropTrialDate ? { reviewDueAt: null } : {}) },
      now,
    ),
    reviewDueAt: dropTrialDate ? null : member.reviewDueAt || null,
    onboardingStep: member.groupJoinedAt
      ? "joined"
      : member.onboardingStep ||
        (member.admissionVerifiedAt
          ? ["join_pending", "invite_sent"].includes(member.status)
            ? "join_pending"
            : "eligible"
          : member.status === "collecting_info"
            ? "collecting_info"
            : "needs_review"),
    needsReview:
      ambiguous ||
      (member.status === "active_paid" &&
        (!validPastDate(member.paidAt, now) ||
          !member.reviewDueAt ||
          !Number.isFinite(Date.parse(member.reviewDueAt)) ||
          Date.parse(member.paidAt!) >= Date.parse(member.reviewDueAt))),
    renewalStep:
      member.status === "payment_pending"
        ? "payment_pending"
        : member.renewalStep || "",
  };
}

export const qualificationFields = {
  onboardingStep: ["Onboarding Step", "select"],
  admissionVerifiedAt: ["Admission Verified At", "date"],
  verifiedDepositUsdt: ["Verified Deposit USDT", "number"],
  depositEvidenceComplete: ["Deposit Evidence Complete", "checkbox"],
  depositReviewReason: ["Deposit Review Reason", "rich_text"],
  depositReviewedAt: ["Deposit Reviewed At", "date"],
  depositReviewedBy: ["Deposit Reviewed By", "rich_text"],
  volumeSpot30d: ["Volume Spot 30D", "number"],
  volumeFutures30d: ["Volume Futures 30D", "number"],
  volumeTotal30d: ["Volume Total 30D", "number"],
  volumeQualified: ["Volume Qualified", "checkbox"],
  volumeWindowStart: ["Volume Window Start", "date"],
  volumeWindowEnd: ["Volume Window End", "date"],
  volumeCheckedAt: ["Volume Checked At", "date"],
  volumeCheckError: ["Volume Check Error", "rich_text"],
  qualificationCheckedAt: ["Qualification Checked At", "date"],
} as const;
export type QualificationFields = {
  onboardingStep?: string;
  admissionVerifiedAt?: string | null;
  verifiedDepositUsdt?: number | null;
  depositEvidenceComplete?: boolean;
  depositReviewReason?: string;
  depositReviewedAt?: string | null;
  depositReviewedBy?: string;
  volumeSpot30d?: number | null;
  volumeFutures30d?: number | null;
  volumeTotal30d?: number | null;
  volumeQualified?: boolean;
  volumeWindowStart?: string | null;
  volumeWindowEnd?: string | null;
  volumeCheckedAt?: string | null;
  volumeCheckError?: string;
  qualificationCheckedAt?: string | null;
  qualificationFieldsAvailable?: boolean;
};
