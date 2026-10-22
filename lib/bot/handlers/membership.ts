import { getRuntimeConfig } from "@/lib/config";
import { addDays, formatDateTime, isPast, isoDateTime } from "@/lib/dates";
import { hasCurrentPaidPeriod } from "@/lib/membership-policy";
import { findMemberByTelegramId, updateMember } from "@/lib/notion";
import { nonExpiringStatuses } from "@/lib/status";
import {
  type TelegramChatJoinRequest,
  type TelegramChatMemberUpdated,
  approveChatJoinRequest,
  declineChatJoinRequest,
  revokeChatInviteLink,
  sendMessage,
} from "@/lib/telegram";
import { normalizeBotMember } from "@/lib/bot/member-policy";
import { userId } from "@/lib/bot/utils";

export async function handleJoinRequest(request: TelegramChatJoinRequest, now: Date) {
  const record = await findMemberByTelegramId(userId(request.from.id));
  const member = record ? await normalizeBotMember(record, now) : null;
  const inviteLink = request.invite_link?.invite_link || "";
  const due = member?.reviewDueAt ? Date.parse(member.reviewDueAt) : NaN;
  const hasValidPeriod = Number.isFinite(due) && due > now.getTime();
  const isNonExpiringMember = Boolean(member && nonExpiringStatuses.has(member.status));
  const isPaidRejoin = Boolean(member && hasValidPeriod &&
    (member.status === "active_paid" || hasCurrentPaidPeriod(member, now)));
  const isTrialRejoin = Boolean(member && hasValidPeriod &&
    (member.status === "trial_active" ||
      (!member.paidAt && (member.status === "join_pending" || (member.groupJoinedAt && member.status === "payment_pending")))));
  const isFirstTrial = Boolean(member && member.status === "join_pending" && !member.groupJoinedAt && !member.paidAt &&
    !member.reviewDueAt);
  const valid = member &&
    (isNonExpiringMember || isPaidRejoin || isTrialRejoin || isFirstTrial) &&
    !["expired", "kicked", "denied"].includes(member.status) &&
    member.inviteLink === inviteLink && Boolean(inviteLink) &&
    member.inviteExpiresAt && !isPast(member.inviteExpiresAt, now);

  if (!valid || !member) {
    await declineChatJoinRequest(request.from.id);
    if (member) {
      await updateMember(member.pageId, {
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: "Join request declined: invalid invite or membership requires review",
      });
    }
    return;
  }

  const config = getRuntimeConfig();
  const reviewDueAt = isFirstTrial ? isoDateTime(addDays(now, config.trialDays)) : member.reviewDueAt;
  const statusAfterJoin = isNonExpiringMember || member.status === "payment_pending" ? member.status : isPaidRejoin ? "active_paid" : "trial_active";
  await approveChatJoinRequest(request.from.id);
  await revokeChatInviteLink(inviteLink);
  await updateMember(member.pageId, {
    status: statusAfterJoin,
    groupJoinedAt: member.groupJoinedAt || isoDateTime(now),
    reviewDueAt,
    ...(isFirstTrial ? {
      renewalStep: "",
      ...(member.reminderFieldsAvailable !== false ? {
        renewalReminderSentAt: null,
        renewalReminder3DaySentAt: null,
        renewalReminderDueAt: null,
      } : {}),
    } : {}),
    inviteLink: null,
    inviteExpiresAt: null,
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Join request approved",
  });
  await sendMessage(
    request.user_chat_id,
    isNonExpiringMember
      ? "入群申請已通過，你的帳號已設定為免續費限制狀態。"
      : `入群申請已通過！${isFirstTrial ? "體驗期" : "目前會籍"}有效期限至 ${formatDateTime(reviewDueAt)}。到期前會提醒續訂，Telegram 群組仍會保留。`,
  );
}

export async function handleChatMember(update: TelegramChatMemberUpdated, now: Date) {
  if (!["member", "administrator", "creator"].includes(update.new_chat_member.status)) return;
  const joinedUser = update.new_chat_member.user;
  if (joinedUser.is_bot) return;
  const member = await findMemberByTelegramId(userId(joinedUser.id));
  if (!member) return;
  // Observing someone in the funnel is not evidence of a paid/trial membership.
  // Do not remove them, change Status, or start a new trial from this event.
  await updateMember(member.pageId, {
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Telegram group presence observed; membership unchanged",
  });
}
