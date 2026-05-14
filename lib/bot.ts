import { getRuntimeConfig } from "@/lib/config";
import { addDays, daysUntil, isPast, isoDateTime } from "@/lib/dates";
import {
  type Member,
  findMemberByTelegramId,
  findMemberByTelegramUsername,
  listMembers,
  updateMember,
} from "@/lib/notion";
import { activeGroupStatuses, nonExpiringStatuses } from "@/lib/status";
import {
  type TelegramCallbackQuery,
  type TelegramChatJoinRequest,
  type TelegramChatMemberUpdated,
  type TelegramMessage,
  type TelegramUpdate,
  answerCallbackQuery,
  approveChatJoinRequest,
  createChatInviteLink,
  declineChatJoinRequest,
  kickChatMember,
  revokeChatInviteLink,
  sendMessage,
  unbanChatMember,
} from "@/lib/telegram";

const INVITE_TTL_HOURS = 24;
const RENEWAL_REMINDER_DAYS = 7;
const FLIP_SUCCESS_TAG = "翻倉成功";
const RENEWAL_OFFER = [
  "續費方案：",
  "收費方式：",
  "3個月100U，一個月50U。（目前沒有年訂閱方案）",
  "",
  "可以使用交易所內部轉帳給小夏：",
  "MEXC - UID：77242747",
  "BITMART - UID：15157885",
].join("\n");
const MANUAL_PAYMENT_REVIEW =
  "目前暫不串接付款金流，收款由人工審核。完成轉帳後，請回覆轉帳截圖或交易資訊，管理員確認後會更新你的會籍狀態。";

export const exchanges = {
  MEXC: {
    name: "MEXC",
    url: "https://www.mexc.com/zh-TW/acquisition/custom-sign-up?shareCode=mexc-Xplan",
  },
  BitMart: {
    name: "BitMart",
    url: "https://www.bitmart.com/zh-TW/invite/cMPDb9",
  },
} as const;

function userId(value: number): string {
  return String(value);
}

function usernameFromMessage(message: TelegramMessage): string {
  return message.from?.username ? `@${message.from.username}` : "";
}

export function isStartCommand(text: string | undefined): boolean {
  if (!text) return false;
  const [command] = text.trim().split(/\s+/, 1);
  return /^\/start(?:@[A-Za-z0-9_]+)?$/i.test(command || "");
}

function teacherContactKeyboard() {
  const config = getRuntimeConfig();
  return [
    [
      {
        text: "聯絡夏老師",
        url: `tg://user?id=${config.teacherTelegramUid}`,
      },
    ],
  ];
}

function renewalKeyboard() {
  return [
    [
      { text: "我要繼續留在群組", callback_data: "renewal:stay" },
      { text: "暫時不續留", callback_data: "renewal:leave" },
    ],
  ];
}

function trialResultKeyboard() {
  return [
    [
      { text: "我已經翻倉成功", callback_data: "trial_result:success" },
      { text: "尚未翻倉成功", callback_data: "trial_result:not_yet" },
    ],
  ];
}

function renewalReminderMessage(member: Member) {
  const memberType = member.status === "active_paid" ? "付費會籍" : "體驗期";
  return [
    `你的${memberType}將在 7 天內到期。`,
    RENEWAL_OFFER,
    "到期時 Bot 會再次詢問是否續費。",
  ].join("\n\n");
}

function trialExpiredMessage() {
  return [
    "你的 30 天體驗期已到期。",
    RENEWAL_OFFER,
    "請先確認目前是否已經翻倉成功。",
  ].join("\n\n");
}

function paidExpiredMessage() {
  return [
    "你的付費會籍已到期。",
    RENEWAL_OFFER,
    "請確認是否要續費並繼續留在群組。",
  ].join("\n\n");
}

function pnlQuestion() {
  return "請直接回覆目前的合約收益概略即可，並附上簡單的文字描述現況";
}

function renewalOfferQuestion() {
  return [
    "已收到你的成果回覆。",
    RENEWAL_OFFER,
    "請確認是否要轉成續費的收費會員方案。",
  ].join("\n\n");
}

function shouldSendRenewalReminder(member: Member, now: Date): boolean {
  if (member.renewalReminderSentAt || !member.reviewDueAt) return false;
  const days = daysUntil(member.reviewDueAt, now);
  return days !== null && days >= 0 && days <= RENEWAL_REMINDER_DAYS;
}

function addTag(tags: string[], tag: string): string[] {
  return tags.includes(tag) ? tags : [...tags, tag];
}

async function sendPaymentRequest(member: Member, chatId: string | number, now: Date) {
  const config = getRuntimeConfig();
  const deadline = addDays(now, config.paymentGraceDays);
  await updateMember(member.pageId, {
    status: "payment_pending",
    renewalStep: "payment_pending",
    paymentDeadlineAt: isoDateTime(deadline),
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Payment link sent",
  });
  await sendMessage(
    chatId,
    [
      "已收到你的續費意願，請依照以下方式完成付款。",
      RENEWAL_OFFER,
      MANUAL_PAYMENT_REVIEW,
    ].join("\n\n"),
  );
}

async function refuseAccess(chatId: number, reason: string) {
  await sendMessage(
    chatId,
    [
      `目前無法提供入群連結：${reason}`,
      "請點擊下方按鈕聯絡夏老師協助確認名單資料。",
    ].join("\n\n"),
    teacherContactKeyboard(),
  );
}

async function createInviteForMember(member: Member, chatId: number, now: Date) {
  if (member.telegramUserId) {
    await unbanChatMember(member.telegramUserId);
  }

  const expiresAt = addDays(now, INVITE_TTL_HOURS / 24);
  const invite = await createChatInviteLink({
    name: `user-${member.telegramUserId}`.slice(0, 32),
    expireDate: expiresAt,
  });

  await updateMember(member.pageId, {
    status: nonExpiringStatuses.has(member.status) ? member.status : "join_pending",
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

async function handleStart(message: TelegramMessage, now: Date) {
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

  if (activeGroupStatuses.has(member.status) && member.groupJoinedAt) {
    await sendMessage(message.chat.id, "你目前已是有效成員，不需要重新申請入群。");
    return;
  }

  if (
    member.inviteLink &&
    member.inviteExpiresAt &&
    !isPast(member.inviteExpiresAt, now) &&
    (member.status === "join_pending" || nonExpiringStatuses.has(member.status))
  ) {
    await sendMessage(message.chat.id, `你已有尚未過期的專屬入群連結：\n${member.inviteLink}`);
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

async function handleUidMessage(message: TelegramMessage, now: Date) {
  if (!message.from || !message.text) return;
  const member = await findMemberByTelegramId(userId(message.from.id));
  if (!member) {
    await handleStart(message, now);
    return;
  }

  if (member.status === "renewal_due" && member.renewalStep === "awaiting_pnl") {
    const finalPnl = message.text.trim();
    if (finalPnl.length < 1) {
      await sendMessage(message.chat.id, pnlQuestion());
      return;
    }
    await updateMember(member.pageId, {
      finalPnl,
      renewalStep: "renewal_offer_sent",
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "Final P/L captured",
    });
    await sendMessage(message.chat.id, renewalOfferQuestion(), renewalKeyboard());
    return;
  }

  await handleStart(message, now);
}

async function handleCallback(query: TelegramCallbackQuery, now: Date) {
  if (!query.data) return;
  await answerCallbackQuery(query.id);

  const member = await findMemberByTelegramId(userId(query.from.id));
  if (!member) {
    await refuseAccess(
      query.from.id,
      "你不在目前的 Notion 名單內，或表單上的 Telegram username 與目前帳號不一致。",
    );
    return;
  }

  if (
    query.data === "trial_result:success" ||
    query.data === "trial_result:not_yet"
  ) {
    await updateMember(member.pageId, {
      tags:
        query.data === "trial_result:success"
          ? addTag(member.tags, FLIP_SUCCESS_TAG)
          : member.tags,
      renewalStep: "awaiting_pnl",
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage:
        query.data === "trial_result:success"
          ? "Trial result marked flip success"
          : "Trial result marked not yet",
    });
    await sendMessage(query.from.id, pnlQuestion());
    return;
  }

  if (query.data === "renewal:stay") {
    await sendPaymentRequest(member, query.from.id, now);
    return;
  }

  if (query.data === "renewal:leave") {
    await kickChatMember(member.telegramUserId);
    await updateMember(member.pageId, {
      status: "kicked",
      renewalStep: "completed",
      kickReason: "user_declined_renewal",
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "User declined renewal and was removed",
    });
    await sendMessage(query.from.id, "已收到，你將會被移出群組。之後需要重新加入時請聯絡管理員。");
  }
}

async function handleJoinRequest(request: TelegramChatJoinRequest, now: Date) {
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
  await approveChatJoinRequest(request.from.id);
  await revokeChatInviteLink(acceptedInviteLink);
  await updateMember(member.pageId, {
    status: isNonExpiringMember ? member.status : "trial_active",
    groupJoinedAt: isoDateTime(now),
    reviewDueAt: isNonExpiringMember
      ? null
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
      : "入群申請已通過，30 天後我會再詢問你是否要繼續留在群組。",
  );
}

async function handleChatMember(update: TelegramChatMemberUpdated, now: Date) {
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

export async function handleTelegramUpdate(update: TelegramUpdate, now = new Date()) {
  if (update.message?.chat.type === "private") {
    if (isStartCommand(update.message.text)) {
      await handleStart(update.message, now);
    } else {
      await handleUidMessage(update.message, now);
    }
    return;
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query, now);
    return;
  }

  if (update.chat_join_request) {
    await handleJoinRequest(update.chat_join_request, now);
    return;
  }

  if (update.chat_member) {
    await handleChatMember(update.chat_member, now);
  }
}

export async function runDailyMembershipJob(now = new Date()) {
  const config = getRuntimeConfig();
  const members = await listMembers({ limit: 500 });
  const results: Array<{ pageId: string; action: string }> = [];

  for (const member of members) {
    if (member.status === "trial_active" && isPast(member.reviewDueAt, now)) {
      await sendMessage(
        member.telegramUserId,
        trialExpiredMessage(),
        trialResultKeyboard(),
      );
      await updateMember(member.pageId, {
        status: "renewal_due",
        renewalStep: "awaiting_trial_result",
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: "Trial expired question sent",
      });
      results.push({ pageId: member.pageId, action: "trial_expired_question_sent" });
      continue;
    }

    if (member.status === "active_paid" && isPast(member.reviewDueAt, now)) {
      await sendMessage(member.telegramUserId, paidExpiredMessage(), renewalKeyboard());
      await updateMember(member.pageId, {
        status: "renewal_due",
        renewalStep: "renewal_offer_sent",
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: "Paid renewal question sent",
      });
      results.push({ pageId: member.pageId, action: "paid_renewal_question_sent" });
      continue;
    }

    if (
      (member.status === "trial_active" || member.status === "active_paid") &&
      shouldSendRenewalReminder(member, now)
    ) {
      await sendMessage(member.telegramUserId, renewalReminderMessage(member));
      await updateMember(member.pageId, {
        renewalReminderSentAt: isoDateTime(now),
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: "Renewal reminder sent",
      });
      results.push({ pageId: member.pageId, action: "renewal_reminder_sent" });
      continue;
    }

    if (
      member.status === "renewal_due" &&
      isPast(isoDateTime(addDays(new Date(member.reviewDueAt || now), config.paymentGraceDays)), now)
    ) {
      await kickChatMember(member.telegramUserId);
      await updateMember(member.pageId, {
        status: "expired",
        kickReason: "renewal_not_confirmed",
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: "Removed after renewal grace period",
      });
      results.push({ pageId: member.pageId, action: "removed_no_renewal_response" });
      continue;
    }

    if (member.status === "payment_pending" && isPast(member.paymentDeadlineAt, now)) {
      await kickChatMember(member.telegramUserId);
      await updateMember(member.pageId, {
        status: "expired",
        kickReason: "payment_deadline_missed",
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: "Removed after payment deadline",
      });
      results.push({ pageId: member.pageId, action: "removed_payment_deadline" });
    }
  }

  return results;
}
