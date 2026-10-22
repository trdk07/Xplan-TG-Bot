import { getRuntimeConfig } from "@/lib/config";
import { isPast, isoDateTime } from "@/lib/dates";
import { getMexcDirectSubaffiliate, mexcDepositMeetsMinimum } from "@/lib/mexc";
import {
  type Member,
  findMemberByTelegramId,
  findMemberByTelegramUsername,
  normalizeExchangeUid,
  updateMember,
} from "@/lib/notion";
import {
  activeGroupStatuses,
  blockedEntryStatuses,
  memberStatusLabel,
  nonExpiringStatuses,
} from "@/lib/status";
import { type TelegramMessage, sendMessage } from "@/lib/telegram";
import { createInviteForMember, needsMexcUidCollection, refuseAccess } from "@/lib/bot/invite";
import { isPaymentPending } from "@/lib/member-state";
import { normalizeBotMember } from "@/lib/bot/member-policy";
import { resolveLegacyStatus } from "@/lib/membership-policy";
import { MEXC_UID_MESSAGE, PAYMENT_PROOF_INSTRUCTIONS, PAYMENT_EXPIRED_MESSAGE, PAYMENT_REVIEW_PENDING_MESSAGE, membershipExpiredMessage } from "@/lib/bot/messages";
import { rejoinKeyboard } from "@/lib/bot/keyboards";
import { handlePaymentProofMessage, hasSubmittedPaymentProof } from "@/lib/bot/handlers/payment";
import { mexcUidFromMessage, userId, usernameFromMessage } from "@/lib/bot/utils";

export async function handleStart(message: TelegramMessage, now: Date) {
  if (!message.from) return;
  const telegramUserId = userId(message.from.id);
  let member = await findMemberByTelegramId(telegramUserId);

  if (!member) {
    const matchedByUsername = await findMemberByTelegramUsername(
      message.from.username,
    );
    if (matchedByUsername) {
      await updateMember(matchedByUsername.pageId, {
        telegramUserId,
        telegramUsername: usernameFromMessage(message),
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: "Telegram User ID backfilled from username match",
      });
      member = {
        ...matchedByUsername,
        telegramUserId,
        telegramUsername: usernameFromMessage(message),
      };
    }
  }

  if (!member) {
    await refuseAccess(
      message.chat.id,
      "你不在目前的 Notion 名單內，或表單上的 Telegram username 與目前帳號不一致。",
    );
    return;
  }

  member = await normalizeBotMember(member, now);
  if (resolveLegacyStatus(member, now).needsReview) {
    await refuseAccess(message.chat.id, "舊會籍紀錄需要由助理確認，現有 Telegram 群組不受影響。");
    return;
  }
  if (member.status !== "kicked" && member.status !== "denied" && isPaymentPending(member)) {
    await sendMessage(message.chat.id, hasSubmittedPaymentProof(member) ? PAYMENT_REVIEW_PENDING_MESSAGE : isPast(member.paymentDeadlineAt, now) ? PAYMENT_EXPIRED_MESSAGE : PAYMENT_PROOF_INSTRUCTIONS);
    return;
  }
  if (member.status === "expired") {
    await sendMessage(message.chat.id, membershipExpiredMessage(member), rejoinKeyboard());
    return;
  }
  if (blockedEntryStatuses.has(member.status)) {
    await updateMember(member.pageId, {
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: `Invite refused for blocked status: ${member.status}`,
    });
    await refuseAccess(
      message.chat.id,
      `目前的會員狀態是「${memberStatusLabel(member.status)}」，需由助理重新確認。`,
    );
    return;
  }

  if (activeGroupStatuses.has(member.status) && member.groupJoinedAt) {
    await sendMessage(
      message.chat.id,
      "你目前已是有效成員，不需要重新申請入群。",
    );
    return;
  }

  if (
    member.inviteLink &&
    member.inviteExpiresAt &&
    !isPast(member.inviteExpiresAt, now) &&
    (member.status === "join_pending" || nonExpiringStatuses.has(member.status))
  ) {
    await sendMessage(
      message.chat.id,
      `你已有尚未過期的專屬入群連結：\n${member.inviteLink}`,
    );
    return;
  }

  if (needsMexcUidCollection(member)) {
    await updateMember(member.pageId, {
      status: "collecting_info",
      telegramUserId,
      telegramUsername: usernameFromMessage(message),
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "MEXC UID requested",
    });
    await sendMessage(message.chat.id, MEXC_UID_MESSAGE);
    return;
  }

  await createInviteForMember(
    {
      ...member,
      telegramUserId,
      telegramUsername: usernameFromMessage(message),
    },
    message.chat.id,
    now,
  );
}

export async function handleMexcUidMessage(
  member: Member,
  message: TelegramMessage,
  now: Date,
) {
  const submittedUid = mexcUidFromMessage(message);
  if (!submittedUid) {
    await updateMember(member.pageId, {
      status: "collecting_info",
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "MEXC UID missing",
    });
    await refuseAccess(message.chat.id, "沒有 UID，無法確認 MEXC 下級帳號資料。");
    return;
  }

  const existingUid = normalizeExchangeUid(member.exchangeUid);
  if (existingUid && existingUid !== normalizeExchangeUid(submittedUid)) {
    await updateMember(member.pageId, {
      status: "collecting_info",
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "Submitted MEXC UID mismatched Notion UID",
    });
    await refuseAccess(
      message.chat.id,
      "你提供的 MEXC UID 與系統紀錄的 MEXC UID 不一致，請聯絡小夏協助確認。",
    );
    return;
  }

  const config = getRuntimeConfig();
  let referral: Awaited<ReturnType<typeof getMexcDirectSubaffiliate>> = null;
  try {
    referral = await getMexcDirectSubaffiliate(submittedUid, now);
  } catch {
    await updateMember(member.pageId, {
      status: "collecting_info",
      exchangeUid: submittedUid,
      uidSubmittedAt: isoDateTime(now),
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "MEXC UID verification failed",
    });
    await refuseAccess(
      message.chat.id,
      "無法連接 MEXC 系統，請稍後再試，或聯絡小夏協助確認。",
    );
    return;
  }

  if (!referral) {
    await updateMember(member.pageId, {
      status: "collecting_info",
      exchangeUid: submittedUid,
      uidSubmittedAt: isoDateTime(now),
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "MEXC UID not found in affiliate list",
    });
    await refuseAccess(
      message.chat.id,
      "查無此 MEXC UID，請確認是否使用我們的 MEXC 推薦連結完成註冊，或聯絡小夏協助確認。",
    );
    return;
  }

  if (!mexcDepositMeetsMinimum(referral, config.mexcMinDepositUsdt)) {
    await updateMember(member.pageId, {
      status: "collecting_info",
      exchangeUid: submittedUid,
      uidSubmittedAt: isoDateTime(now),
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: `MEXC deposit below minimum: ${referral.depositAmount} USDT`,
    });
    await refuseAccess(
      message.chat.id,
      `入金金額未達 ${config.mexcMinDepositUsdt} USDT，請確認入金後再試，或聯絡小夏協助確認。`,
    );
    return;
  }

  await updateMember(member.pageId, {
    status: "eligible",
    exchangeRegistered: true,
    exchangeName: "Mexc（抹茶）",
    exchangeUid: submittedUid,
    uidSubmittedAt: isoDateTime(now),
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "MEXC UID verified",
  });
  await createInviteForMember(
    {
      ...member,
      status: "eligible",
      exchangeRegistered: true,
      exchangeName: "Mexc（抹茶）",
      exchangeUid: submittedUid,
      telegramUsername: usernameFromMessage(message) || member.telegramUsername,
    },
    message.chat.id,
    now,
  );
}

export async function handleUidMessage(message: TelegramMessage, now: Date) {
  if (!message.from) return;
  const record = await findMemberByTelegramId(userId(message.from.id));
  const member = record ? await normalizeBotMember(record, now) : null;
  if (!member) {
    await handleStart(message, now);
    return;
  }

  if (member.status !== "kicked" && member.status !== "denied" && isPaymentPending(member)) {
    await handlePaymentProofMessage(member, message, now);
    return;
  }

  if (needsMexcUidCollection(member)) {
    await handleMexcUidMessage(member, message, now);
    return;
  }

  await handleStart(message, now);
}
