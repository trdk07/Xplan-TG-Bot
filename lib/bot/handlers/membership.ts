import { getRuntimeConfig } from "@/lib/config";
import { addDays, isPast, isoDateTime } from "@/lib/dates";
import { isRenewalNoticeCandidate } from "@/lib/member-state";
import { type Member, findMemberByTelegramId, updateMember } from "@/lib/notion";
import { activeGroupStatuses, nonExpiringStatuses } from "@/lib/status";
import {
  type TelegramChatJoinRequest,
  type TelegramChatMemberUpdated,
  approveChatJoinRequest,
  declineChatJoinRequest,
  kickChatMember,
  revokeChatInviteLink,
  sendMessage,
} from "@/lib/telegram";
import { RENEWAL_EXPIRED_MESSAGE } from "@/lib/bot/messages";
import { userId } from "@/lib/bot/utils";

function renewalGraceDeadline(member: Member, now: Date): Date {
  const config = getRuntimeConfig();
  return addDays(new Date(member.reviewDueAt || now), config.paymentGraceDays);
}

function isRenewalGraceExpired(member: Member, now: Date): boolean {
  return isPast(isoDateTime(renewalGraceDeadline(member, now)), now);
}

async function expireRenewalDueMember(
  member: Member,
  chatId: string | number,
  now: Date,
) {
  await kickChatMember(member.telegramUserId);
  await updateMember(member.pageId, {
    status: "expired",
    kickReason: "renewal_not_confirmed",
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Removed after delayed renewal response",
  });
  await sendMessage(chatId, RENEWAL_EXPIRED_MESSAGE);
}

function isEarlyRenewalEligible(member: Member, now: Date): boolean {
  return isRenewalNoticeCandidate(member, now, {
    allowAlreadyReminded: true,
  });
}

export async function handleJoinRequest(request: TelegramChatJoinRequest, now: Date) {
  const member = await findMemberByTelegramId(userId(request.from.id));
  const inviteLink = request.invite_link?.invite_link || "";

  const valid =
    member &&
    (member.status === "join_pending" ||
      member.status === "invite_sent" ||
      nonExpiringStatuses.has(member.status)) &&
    member.inviteLink &&
    member.inviteLink === inviteLink &&
    member.inviteExpiresAt &&
    !isPast(member.inviteExpiresAt, now);

  if (!valid || !member) {
    await declineChatJoinRequest(request.from.id);
    if (member) {
      await updateMember(member.pageId, {
        kickReason: "invalid_or_expired_join_request",
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: "Join request declined",
      });
    }
    return;
  }

  const config = getRuntimeConfig();
  const acceptedInviteLink = member.inviteLink!;
  const isNonExpiringMember = nonExpiringStatuses.has(member.status);
  const isPaidRejoin =
    !isNonExpiringMember &&
    Boolean(member.paidAt) &&
    Boolean(member.reviewDueAt) &&
    !isPast(member.reviewDueAt, now);
  const statusAfterJoin = isNonExpiringMember
    ? member.status
    : isPaidRejoin
      ? "active_paid"
      : "trial_active";

  await approveChatJoinRequest(request.from.id);
  await revokeChatInviteLink(acceptedInviteLink);
  await updateMember(member.pageId, {
    status: statusAfterJoin,
    groupJoinedAt: isoDateTime(now),
    reviewDueAt:
      isNonExpiringMember || isPaidRejoin
        ? member.reviewDueAt ?? null
        : isoDateTime(addDays(now, config.trialDays)),
    renewalStep: "",
    renewalReminderSentAt: null,
    inviteLink: null,
    inviteExpiresAt: null,
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Join request approved",
    kickReason: "",
  });

  await sendMessage(
    request.user_chat_id,
    isNonExpiringMember
      ? "入群申請已通過，你的帳號已設定為免續費限制狀態。"
      : isPaidRejoin
        ? `入群申請已通過！你的訂閱已恢復，有效期限至 ${member.reviewDueAt ? new Date(member.reviewDueAt).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }) : ""}。`
        : "入群申請已通過，30 天後我會再詢問你是否要繼續留在群組。",
  );
}

export async function handleChatMember(update: TelegramChatMemberUpdated, now: Date) {
  const newStatus = update.new_chat_member.status;
  if (!["member", "administrator", "creator"].includes(newStatus)) return;

  const joinedUser = update.new_chat_member.user;
  if (joinedUser.is_bot) return;

  const member = await findMemberByTelegramId(userId(joinedUser.id));
  if (!member || !activeGroupStatuses.has(member.status)) {
    await kickChatMember(joinedUser.id);
    if (member) {
      await updateMember(member.pageId, {
        status: "kicked",
        kickReason: "unauthorized_group_join",
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: "Unauthorized member removed",
      });
    }
    return;
  }

  await updateMember(member.pageId, {
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Group membership observed as valid",
  });
}
