import { v2Enabled } from "@/lib/membership-v2";
import { runDailyV2 } from "@/lib/bot/v2-job";
import { getRuntimeConfig } from "@/lib/config";
import { isPast, isoDateTime } from "@/lib/dates";
import { isRenewalNoticeCandidate } from "@/lib/member-state";
import { type Member, listMembers, updateMember } from "@/lib/notion";
import { hasCurrentMembership } from "@/lib/membership-policy";
import { nonExpiringStatuses } from "@/lib/status";
import { hasSubmittedPaymentProof } from "@/lib/bot/handlers/payment";
import { sendMessage } from "@/lib/telegram";
import { rejoinKeyboard, renewalKeyboard } from "@/lib/bot/keyboards";
import {
  membershipExpiredMessage,
  renewalReminderMessage,
} from "@/lib/bot/messages";
import { normalizeBotMember } from "@/lib/bot/member-policy";

export async function sendRenewalReminder(
  member: Member,
  now: Date,
  lastBotMessage = "7-day expiry reminder sent",
  stage: "7day" | "3day" = "7day",
) {
  if (!member.telegramUserId || !member.reviewDueAt) return;
  if (member.reminderFieldsAvailable === false) {
    throw new Error(
      "Notion reminder fields are missing; run schema setup before sending reminders.",
    );
  }
  await sendMessage(
    member.telegramUserId,
    renewalReminderMessage(member, stage),
    renewalKeyboard(member.reviewDueAt),
  );
  const samePeriod =
    Boolean(member.renewalReminderDueAt) &&
    Date.parse(member.renewalReminderDueAt!) === Date.parse(member.reviewDueAt);
  const legacySentAt = member.lastBotCheckAt || isoDateTime(now);
  const previousSevenDay = samePeriod
    ? member.renewalReminderSentAt
    : !member.renewalReminderDueAt && member.status === "sent_7day_survey"
      ? member.renewalReminderSentAt || legacySentAt
      : null;
  const previousThreeDay = samePeriod
    ? member.renewalReminder3DaySentAt
    : !member.renewalReminderDueAt && member.status === "sent_3day_offer"
      ? member.renewalReminder3DaySentAt || legacySentAt
      : null;
  await updateMember(member.pageId, {
    renewalReminderDueAt: member.reviewDueAt,
    renewalReminderSentAt:
      stage === "7day" ? isoDateTime(now) : previousSevenDay,
    renewalReminder3DaySentAt:
      stage === "3day" ? isoDateTime(now) : previousThreeDay,
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage,
  });
}

// Kept for the existing admin action, now a factual expiry notice with no access action.
export async function resendRenewalDueReminder(
  member: Member,
  now: Date,
  lastBotMessage = "Expiry notice resent manually by admin",
) {
  if (!member.telegramUserId) return;
  await sendMessage(
    member.telegramUserId,
    membershipExpiredMessage(member),
    rejoinKeyboard(),
  );
  await updateMember(member.pageId, {
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage,
  });
}

export async function runDailyMembershipJob(now = new Date()) {
  if (v2Enabled()) {
    const results = await runDailyV2(now);
    await notifyTeacherOfDailyJobErrors(results, now);
    return results;
  }
  const members = await listMembers();
  const results: Array<{ pageId: string; action: string; detail?: string }> =
    [];
  for (const original of members) {
    try {
      const previousStatus = original.status;
      const member = await normalizeBotMember(original, now);
      const newlyExpired =
        previousStatus !== "expired" && member.status === "expired";
      const expiringMembership =
        !nonExpiringStatuses.has(member.status) &&
        hasCurrentMembership(member, now);
      if (newlyExpired) {
        // Status is persisted first, even when no Telegram account is linked.
        if (member.telegramUserId) {
          await sendMessage(
            member.telegramUserId,
            membershipExpiredMessage(member),
            rejoinKeyboard(),
          );
        }
        results.push({ pageId: member.pageId, action: "membership_expired" });
        continue;
      }

      // A payment deadline only closes that application. It never shortens membership.
      if (
        member.renewalStep === "payment_pending" &&
        isPast(member.paymentDeadlineAt, now) &&
        !hasSubmittedPaymentProof(member)
      ) {
        await updateMember(member.pageId, {
          renewalStep: "payment_expired",
          lastBotCheckAt: isoDateTime(now),
          lastBotMessage:
            "Payment application expired; Telegram group access retained",
        });
      }
      if (!expiringMembership) continue;
      if (isRenewalNoticeCandidate(member, now, { stage: "3day" })) {
        await sendRenewalReminder(
          member,
          now,
          "3-day expiry reminder sent",
          "3day",
        );
        results.push({ pageId: member.pageId, action: "3day_reminder_sent" });
      } else if (
        isRenewalNoticeCandidate(member, now, { stage: "7day" }) &&
        !isRenewalNoticeCandidate(member, now, {
          stage: "3day",
          allowAlreadyReminded: true,
        })
      ) {
        await sendRenewalReminder(member, now);
        results.push({ pageId: member.pageId, action: "7day_reminder_sent" });
      }
    } catch (error) {
      results.push({
        pageId: original.pageId,
        action: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await notifyTeacherOfDailyJobErrors(results, now);
  return results;
}

async function notifyTeacherOfDailyJobErrors(
  results: Array<{ pageId: string; action: string; detail?: string }>,
  now: Date,
) {
  const errors = results.filter((result) => result.action === "error");
  if (!errors.length) return;
  const config = getRuntimeConfig();
  const summary = [
    `每日會員檢查任務發生錯誤（${isoDateTime(now)}）`,
    `處理 ${results.length} 人，成功 ${results.length - errors.length}，失敗 ${errors.length}`,
    "",
    ...errors.map((error) => `- ${error.pageId}: ${error.detail}`),
  ].join("\n");
  try {
    await sendMessage(config.teacherTelegramUid, summary);
  } catch (error) {
    console.error("Failed to notify teacher of daily job errors", error);
  }
}
