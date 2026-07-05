import { addDays, isoDateTime } from "@/lib/dates";
import { type Member, normalizeExchangeUid, updateMember } from "@/lib/notion";
import { nonExpiringStatuses } from "@/lib/status";
import { createChatInviteLink, sendMessage, unbanChatMember } from "@/lib/telegram";
import { teacherContactKeyboard } from "@/lib/bot/keyboards";

const INVITE_TTL_HOURS = 24;

export async function refuseAccess(chatId: number, reason: string) {
  await sendMessage(
    chatId,
    [
      `目前無法提供入群連結：${reason}`,
      "請點擊下方按鈕聯絡小夏協助確認名單資料。",
    ].join("\n\n"),
    teacherContactKeyboard(),
  );
}

export function hasVerifiedMexcUid(member: Member): boolean {
  return (
    member.exchangeRegistered && Boolean(normalizeExchangeUid(member.exchangeUid))
  );
}

export function needsMexcUidCollection(member: Member): boolean {
  return (
    (member.status === "eligible" ||
      member.status === "collecting_info" ||
      member.status === "invite_sent" ||
      member.status === "join_pending") &&
    !hasVerifiedMexcUid(member)
  );
}

export async function createInviteForMember(
  member: Member,
  chatId: number,
  now: Date,
) {
  if (member.telegramUserId) {
    await unbanChatMember(member.telegramUserId);
  }

  const expiresAt = addDays(now, INVITE_TTL_HOURS / 24);
  const invite = await createChatInviteLink({
    name: `user-${member.telegramUserId}`.slice(0, 32),
    expireDate: expiresAt,
  });

  await updateMember(member.pageId, {
    status: nonExpiringStatuses.has(member.status)
      ? member.status
      : "join_pending",
    telegramUsername: member.telegramUsername || undefined,
    inviteLink: invite.invite_link,
    inviteExpiresAt: isoDateTime(expiresAt),
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Invite link sent",
  });

  await sendMessage(
    chatId,
    [
      "資料已收到，這是你的專屬短效入群連結。",
      "連結需要 Bot 審核，請不要轉傳；若外流，Bot 仍會依 Telegram ID 拒絕非本人入群。",
      invite.invite_link,
    ].join("\n\n"),
  );
}
