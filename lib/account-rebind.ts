import {
  effectiveMembership,
  exchangeLabel,
  normalizeExchange,
  type Exchange,
} from "@/lib/membership-v2";
import type { Member, MemberPatch } from "@/lib/notion";

/** Verified admission evidence for the new account, when the caller already proved it. */
export type RebindAdmission = {
  verifiedDepositUsdt: number;
  depositEvidenceComplete: boolean;
};

export function sameBoundAccount(left: Member, right: Member) {
  return (
    normalizeExchange(left.exchangeName) ===
      normalizeExchange(right.exchangeName) &&
    left.exchangeUid === right.exchangeUid
  );
}

/** Another member already bound to this exchange account, if any. */
export function findAccountOwner(
  members: Member[],
  pageId: string,
  exchange: Exchange,
  uid: string,
) {
  return members.find(
    (other) =>
      other.pageId !== pageId &&
      normalizeExchange(other.exchangeName) === exchange &&
      other.exchangeUid.trim() === uid,
  );
}

/**
 * Notion patch for moving a member to a new exchange account. Payment facts,
 * Telegram admission and Discord audit fields are kept; evidence that belonged
 * to the old account is cleared. The old account is kept as Previous Exchange.
 */
export function accountRebindPatch(
  member: Member,
  exchange: Exchange,
  uid: string,
  now: Date,
  actor: string,
  admission?: RebindAdmission,
): MemberPatch {
  const previousExchange = normalizeExchange(member.exchangeName);
  const patch: MemberPatch = {
    previousExchange: previousExchange
      ? exchangeLabel(previousExchange)
      : member.exchangeName,
    previousExchangeUid: member.exchangeUid,
    exchangeName: exchangeLabel(exchange),
    exchangeUid: uid,
    uidSubmittedAt: now.toISOString(),
    exchangeRegistered: Boolean(admission),
    onboardingStep: admission
      ? member.groupJoinedAt
        ? "joined"
        : "eligible"
      : "collecting_info",
    admissionVerifiedAt: admission ? now.toISOString() : null,
    verifiedDepositUsdt: admission ? admission.verifiedDepositUsdt : null,
    depositEvidenceComplete: admission
      ? admission.depositEvidenceComplete
      : false,
    depositReviewReason: admission
      ? ""
      : "綁定帳號已變更，須重新核對推薦關係與歷史入金。",
    depositReviewedAt: null,
    depositReviewedBy: "",
    volumeSpot30d: null,
    volumeFutures30d: null,
    volumeTotal30d: null,
    volumeQualified: false,
    volumeWindowStart: null,
    volumeWindowEnd: null,
    volumeCheckedAt: null,
    volumeCheckError: "",
    qualificationCheckedAt: admission ? now.toISOString() : null,
    inviteLink: null,
    inviteExpiresAt: null,
    invitationEmailSent: false,
    lastBotCheckAt: now.toISOString(),
    lastBotMessage: `Bound exchange account changed by ${actor}: ${
      accountLabel(member)
    } -> ${exchangeLabel(exchange)} ${uid}; Discord re-verification required`,
  };
  patch.status = effectiveMembership({ ...member, ...patch }, now);
  return patch;
}

function accountLabel(member: Member) {
  return `${member.exchangeName || "-"} ${member.exchangeUid || "-"}`;
}
