import { getRuntimeConfig } from "@/lib/config";
import { daysUntil, isPast, isoDateTime } from "@/lib/dates";
import { type Member, listMembers, updateMember } from "@/lib/notion";
import { normalMembershipStatuses } from "@/lib/status";
import { kickChatMember, sendMessage } from "@/lib/telegram";
import { earlyRenewalKeyboard, rejoinKeyboard, renewalKeyboard, trialResultKeyboard } from "@/lib/bot/keyboards";
import {
  expiredKickMessage,
  graduationMessage,
  membershipExpiredRenewalMessage,
  renewalReminderMessage,
  sevenDayTrialSurveyMessage,
  subscriptionInfoMessage,
} from "@/lib/bot/messages";

export async function sendRenewalReminder(
  member: Member,
  now: Date,
  lastBotMessage = "Renewal reminder sent",
) {
  await sendMessage(
    member.telegramUserId,
    renewalReminderMessage(member),
    earlyRenewalKeyboard(),
  );
  await updateMember(member.pageId, {
    renewalReminderSentAt: isoDateTime(now),
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage,
  });
}

export async function resendRenewalDueReminder(member: Member, now: Date) {
  await sendMessage(
    member.telegramUserId,
    membershipExpiredRenewalMessage(),
    renewalKeyboard(),
  );
  await updateMember(member.pageId, {
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Renewal due reminder resent manually by admin",
  });
}

export async function runDailyMembershipJob(now = new Date()) {
  const members = await listMembers({ limit: 500 });
  const results: Array<{ pageId: string; action: string; detail?: string }> = [];

  for (const member of members) {
    try {
      // Order 1: renewal_due grace expired → kick
      if (member.status === "renewal_due" && isPast(member.reviewDueAt, now)) {
        await kickChatMember(member.telegramUserId);
        await updateMember(member.pageId, {
          status: "expired",
          kickReason: "renewal_not_confirmed",
          lastBotCheckAt: isoDateTime(now),
          lastBotMessage: "Removed: renewal_due past reviewDueAt",
        });
        await sendMessage(member.telegramUserId, expiredKickMessage(), rejoinKeyboard());
        results.push({ pageId: member.pageId, action: "removed_renewal_due" });
        continue;
      }

      // Order 2: payment_pending past deadline → kick
      if (
        member.status === "payment_pending" &&
        isPast(member.paymentDeadlineAt, now)
      ) {
        await kickChatMember(member.telegramUserId);
        await updateMember(member.pageId, {
          status: "expired",
          kickReason: "payment_deadline_missed",
          lastBotCheckAt: isoDateTime(now),
          lastBotMessage: "Removed: payment_pending past deadline",
        });
        await sendMessage(member.telegramUserId, expiredKickMessage(), rejoinKeyboard());
        results.push({ pageId: member.pageId, action: "removed_payment_pending" });
        continue;
      }

      // Order 3: user_refused past reviewDueAt → kick silently
      if (member.status === "user_refused" && isPast(member.reviewDueAt, now)) {
        await kickChatMember(member.telegramUserId);
        await updateMember(member.pageId, {
          status: "expired",
          kickReason: "user_refused_renewal",
          lastBotCheckAt: isoDateTime(now),
          lastBotMessage: "Removed: user_refused past reviewDueAt",
        });
        await sendMessage(member.telegramUserId, graduationMessage());
        results.push({ pageId: member.pageId, action: "removed_user_refused" });
        continue;
      }

      // Orders 4–6 only apply to normal membership statuses
      if (!normalMembershipStatuses.has(member.status)) continue;

      // Order 4: normal active + past reviewDueAt → send renewal question
      if (isPast(member.reviewDueAt, now)) {
        await sendMessage(
          member.telegramUserId,
          membershipExpiredRenewalMessage(),
          renewalKeyboard(),
        );
        await updateMember(member.pageId, {
          status: "renewal_due",
          renewalStep: "renewal_offer_sent",
          lastBotCheckAt: isoDateTime(now),
          lastBotMessage: "Renewal question sent on expiry",
        });
        results.push({ pageId: member.pageId, action: "renewal_question_sent" });
        continue;
      }

      const daysLeft = daysUntil(member.reviewDueAt, now);
      if (daysLeft === null) continue;

      // Order 5: 1–3 days left, not already sent 3-day offer → send subscription info
      if (member.status !== "sent_3day_offer" && daysLeft >= 1 && daysLeft <= 3) {
        await sendMessage(
          member.telegramUserId,
          subscriptionInfoMessage(),
          renewalKeyboard(),
        );
        await updateMember(member.pageId, {
          status: "sent_3day_offer",
          lastBotCheckAt: isoDateTime(now),
          lastBotMessage: "3-day subscription offer sent",
        });
        results.push({ pageId: member.pageId, action: "3day_offer_sent" });
        continue;
      }

      // Order 6: 4–7 days left, trial or paid (not already surveyed) → send 7-day notice
      if (
        (member.status === "trial_active" || member.status === "active_paid") &&
        daysLeft >= 4 &&
        daysLeft <= 7
      ) {
        if (member.status === "trial_active") {
          await sendMessage(
            member.telegramUserId,
            sevenDayTrialSurveyMessage(),
            trialResultKeyboard(),
          );
          await updateMember(member.pageId, {
            status: "sent_7day_survey",
            renewalStep: "awaiting_trial_result",
            lastBotCheckAt: isoDateTime(now),
            lastBotMessage: "7-day trial survey sent",
          });
          results.push({ pageId: member.pageId, action: "7day_trial_survey_sent" });
        } else {
          await sendMessage(
            member.telegramUserId,
            renewalReminderMessage(member),
            earlyRenewalKeyboard(),
          );
          await updateMember(member.pageId, {
            status: "sent_7day_survey",
            renewalReminderSentAt: isoDateTime(now),
            lastBotCheckAt: isoDateTime(now),
            lastBotMessage: "7-day renewal reminder sent",
          });
          results.push({ pageId: member.pageId, action: "7day_renewal_reminder_sent" });
        }
        continue;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({ pageId: member.pageId, action: "error", detail });
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
