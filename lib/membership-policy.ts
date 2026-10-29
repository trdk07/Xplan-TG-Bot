import {
  v2Enabled,
  currentPaidFacts,
  effectiveMembership,
  migrationPreview,
} from "@/lib/membership-v2";
import type { Member } from "@/lib/notion";
import { addMonths } from "@/lib/dates";
import {
  legacyMemberStatuses,
  nonExpiringStatuses,
  type MemberStatus,
} from "@/lib/status";

export function hasCurrentPaidPeriod(member: Member, now: Date): boolean {
  if (v2Enabled()) return effectiveMembership(member, now) === "active_paid";
  const due = member.reviewDueAt ? Date.parse(member.reviewDueAt) : NaN;
  const paid = member.paidAt ? Date.parse(member.paidAt) : NaN;
  const months = member.subscriptionMonths;
  return (
    Number.isFinite(due) &&
    due > now.getTime() &&
    Number.isFinite(paid) &&
    paid <= now.getTime() &&
    paid < due &&
    Boolean(
      months &&
        months > 0 &&
        addMonths(new Date(paid), months).getTime() >= due,
    )
  );
}

/** Resolve only what the stored dates prove. Ambiguous legacy records stay visible for manual review. */
export function resolveLegacyStatus(
  member: Member,
  now: Date,
): { status: MemberStatus; needsReview: boolean } {
  if (v2Enabled()) {
    const preview = migrationPreview(member, now);
    return {
      status: preview.needsReview ? member.status : preview.status,
      needsReview: preview.needsReview,
    };
  }
  const result = (status: MemberStatus, needsReview = false) => ({
    status,
    needsReview,
  });
  if (member.status === "invite_sent") return result("join_pending");
  if (!(legacyMemberStatuses as readonly string[]).includes(member.status))
    return result(member.status);
  const due = member.reviewDueAt ? Date.parse(member.reviewDueAt) : NaN;
  if (Number.isFinite(due) && due <= now.getTime()) return result("expired");
  if (!Number.isFinite(due)) return result(member.status, true);
  const joined = member.groupJoinedAt ? Date.parse(member.groupJoinedAt) : NaN;
  if (
    !member.paidAt &&
    Number.isFinite(joined) &&
    joined <= now.getTime() &&
    joined < due
  )
    return result("trial_active");
  if (hasCurrentPaidPeriod(member, now)) return result("active_paid");
  // An old payment or missing term evidence cannot upgrade an ambiguous member to paid.
  return result(member.status, true);
}

/** Generic membership access does not require guessing a legacy member's trial/paid tier. */
export function hasCurrentMembership(
  member: Member,
  now = new Date(),
): boolean {
  if (v2Enabled()) return effectiveMembership(member, now) !== "suspended";
  if (nonExpiringStatuses.has(member.status)) return true;
  if (
    ![
      "trial_active",
      "active_paid",
      "payment_pending",
      "sent_7day_survey",
      "sent_3day_offer",
      "user_refused",
      "renewal_due",
    ].includes(member.status)
  )
    return false;
  const due = member.reviewDueAt ? Date.parse(member.reviewDueAt) : NaN;
  return Number.isFinite(due) && due > now.getTime();
}
