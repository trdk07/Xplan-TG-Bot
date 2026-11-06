import { v2Enabled } from "@/lib/membership-v2";
import { createV2Invite } from "@/lib/bot/v2";
import { addDays, isPast, isoDateTime } from "@/lib/dates";
import { type Member, normalizeExchangeUid, updateMember } from "@/lib/notion";
import {
  activeGroupStatuses,
  blockedEntryStatuses,
  nonExpiringStatuses,
} from "@/lib/status";
import {
  createChatInviteLink,
  sendMessage,
  unbanChatMember,
} from "@/lib/telegram";
import { teacherContactKeyboard } from "@/lib/bot/keyboards";
import { escapeHtml } from "@/lib/bot/v2-messages";

export const DEFAULT_APPLICATION_FORM_URL =
  "https://x-plan-sage.vercel.app/apply";

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

/**
 * Applicants who did not arrive from the website (or whose form username differs)
 * have no Notion record. Offer the application form again when it is configured.
 */
export function unknownApplicantMessage(username: string) {
  const formUrl =
    process.env.APPLICATION_FORM_URL || DEFAULT_APPLICATION_FORM_URL;
  const safeUsername = escapeHtml(username);
  return {
    text: [
      "目前找不到你的報名資料。",
      "",
      "可能原因：",
      "・還沒有填寫報名表單",
      "・表單上的 Telegram username 和目前這個帳號不一樣",
      "",
      "請點下方「填寫報名表單」完成報名，送出後稍等一下，再回到這裡重新按 /start。",
      safeUsername
        ? `表單的 Telegram username 請填：<b>${safeUsername}</b>`
        : "你目前沒有設定 Telegram username，請先到 Telegram「設定 → 使用者名稱」設定一個，再填到表單裡。",
      "",
      "如果你已經填過、只是資料填錯，請不要重複填寫，直接聯絡小夏協助更正。",
    ].join("\n"),
    keyboard: [
      [{ text: "填寫報名表單", url: formUrl }],
      ...teacherContactKeyboard(),
    ],
  };
}

export async function refuseUnknownApplicant(
  chatId: number | string,
  username: string,
) {
  const { text, keyboard } = unknownApplicantMessage(username);
  await sendMessage(chatId, text, keyboard);
}

export function hasVerifiedMexcUid(member: Member): boolean {
  return (
    member.exchangeRegistered &&
    Boolean(normalizeExchangeUid(member.exchangeUid))
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
  if (v2Enabled()) return createV2Invite(member, chatId, now);
  if (
    blockedEntryStatuses.has(member.status) ||
    (!nonExpiringStatuses.has(member.status) && isPast(member.reviewDueAt, now))
  ) {
    await refuseAccess(
      chatId,
      "目前會籍需由助理確認，現有 Telegram 群組不受影響。",
    );
    return;
  }
  if (member.telegramUserId) {
    await unbanChatMember(member.telegramUserId);
  }

  const expiresAt = addDays(now, INVITE_TTL_HOURS / 24);
  const invite = await createChatInviteLink({
    name: `user-${member.telegramUserId}`.slice(0, 32),
    expireDate: expiresAt,
  });

  await updateMember(member.pageId, {
    status: activeGroupStatuses.has(member.status)
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
