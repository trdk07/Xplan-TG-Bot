import {
  v2Enabled,
  effectiveMembership,
  migrationPreview,
} from "@/lib/membership-v2";
import { isPast, isoDateTime } from "@/lib/dates";
import { resolveLegacyStatus } from "@/lib/membership-policy";
import { type Member, type MemberPatch, updateMember } from "@/lib/notion";

/** Persist only legacy transitions supported by the current membership evidence. */
export async function normalizeBotMember(
  member: Member,
  now: Date,
): Promise<Member> {
  if (v2Enabled())
    return migrationPreview(member, now).needsReview
      ? member
      : { ...member, status: effectiveMembership(member, now) };
  const resolved =
    ["trial_active", "active_paid", "payment_pending"].includes(
      member.status,
    ) && isPast(member.reviewDueAt, now)
      ? { status: "expired" as const, needsReview: false }
      : resolveLegacyStatus(member, now);
  if (resolved.needsReview || resolved.status === member.status) return member;

  const patch: MemberPatch = { status: resolved.status };
  if (resolved.status === "expired") {
    patch.lastBotCheckAt = isoDateTime(now);
    patch.lastBotMessage = "Membership expired; Telegram group access retained";
  }
  if (member.status === "user_refused") patch.renewalStep = "declined";
  else if (
    ["awaiting_trial_result", "awaiting_pnl", "renewal_offer_sent"].includes(
      member.renewalStep,
    )
  ) {
    patch.renewalStep = "";
  }

  if (
    resolved.status !== "expired" &&
    (member.status === "sent_7day_survey" ||
      member.status === "sent_3day_offer")
  ) {
    // Old notification statuses are themselves evidence that this notice was sent.
    // Save that evidence before dropping the legacy status so it is not sent again.
    if (member.reminderFieldsAvailable === false) {
      throw new Error(
        "Notion reminder fields are missing; run schema setup before migrating reminder statuses.",
      );
    }
    const sentAt = member.lastBotCheckAt || isoDateTime(now);
    patch.renewalReminderDueAt = member.reviewDueAt;
    if (member.status === "sent_7day_survey") {
      patch.renewalReminderSentAt = member.renewalReminderSentAt || sentAt;
    } else {
      patch.renewalReminder3DaySentAt =
        member.renewalReminder3DaySentAt || sentAt;
    }
  }

  await updateMember(member.pageId, patch);
  return { ...member, ...patch };
}
