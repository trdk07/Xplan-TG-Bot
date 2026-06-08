import { getRuntimeConfig } from "@/lib/config";
import { addDays, daysUntil, isPast, isoDateTime } from "@/lib/dates";
import { isRenewalNoticeCandidate } from "@/lib/member-state";
import {
  getMexcDirectSubaffiliate,
  mexcDepositMeetsMinimum,
} from "@/lib/mexc";
import {
  type Member,
  findMemberByTelegramId,
  findMemberByTelegramUsername,
  listMembers,
  normalizeExchangeUid,
  updateMember,
} from "@/lib/notion";
import {
  activeGroupStatuses,
  blockedEntryStatuses,
  memberStatusLabel,
  nonExpiringStatuses,
  normalMembershipStatuses,
} from "@/lib/status";
import {
  type TelegramCallbackQuery,
  type TelegramChatJoinRequest,
  type TelegramChatMemberUpdated,
  type TelegramMessage,
  type TelegramUpdate,
  answerCallbackQuery,
  approveChatJoinRequest,
  editMessageText,
  createChatInviteLink,
  declineChatJoinRequest,
  kickChatMember,
  revokeChatInviteLink,
  sendMessage,
  unbanChatMember,
} from "@/lib/telegram";

const INVITE_TTL_HOURS = 24;
const FLIP_SUCCESS_TAG = "翻倉成功";
const RENEWAL_OFFER = [
  "續費方案：",
  "收費方式：",
  "3個月100U，一個月50U。（目前沒有年訂閱方案）",
  "",
  "可以使用交易所內部轉帳給小夏：",
  "MEXC - UID：77242747",
].join("\n");
const PAYMENT_PROOF_INSTRUCTIONS =
  "下一步：請上傳轉帳截圖，並在這個 Bot 對話輸入 UID 末四碼（4 位數字）。可以把 UID 末四碼寫在圖片說明，或下一則訊息傳 4 位數字。";
const STALE_STEP_MESSAGE =
  "這個按鈕已不是目前可操作的步驟。若需要協助，請聯絡助理確認。";
const RENEWAL_EXPIRED_MESSAGE =
  "這次續費回覆期限已過，系統已停止此續費流程。若需要重新加入或續費，請聯絡助理。";
const PAYMENT_EXPIRED_MESSAGE =
  "付款回覆期限已過，系統已停止此付款流程。若已完成轉帳或需要協助，請聯絡助理。";
const MEXC_UID_MESSAGE =
  "請回覆你的 MEXC UID。Bot 會確認這個 UID 是否已透過我們的 MEXC 註冊連結完成註冊，並確認入金金額是否達 100 USDT。";

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
        text: "聯絡小夏",
        url: `tg://user?id=${config.teacherTelegramUid}`,
      },
    ],
  ];
}

function renewalKeyboard() {
  return [
    [
      { text: "繼續訂閱", callback_data: "renewal:stay" },
      { text: "暫時不續訂", callback_data: "renewal:leave" },
    ],
  ];
}

function rejoinKeyboard() {
  return [[{ text: "申請恢復訂閱", callback_data: "rejoin_apply" }]];
}

function trialResultKeyboard() {
  return [
    [
      { text: "我已經翻倉成功", callback_data: "trial_result:success" },
      { text: "尚未翻倉成功", callback_data: "trial_result:not_yet" },
    ],
  ];
}

function earlyRenewalKeyboard() {
  return [[{ text: "提前開始訂閱", callback_data: "renewal:stay" }]];
}

export function paymentProofRequestKeyboard() {
  return [
    [
      {
        text: "我已完成轉帳，補傳付款資料",
        callback_data: "payment_proof:start",
      },
    ],
  ];
}

export function manualPaymentProofRequestMessage() {
  return [
    "助理已開啟付款資料補傳流程。",
    "",
    "如果你已完成轉帳，請點下方「我已完成轉帳，補傳付款資料」，Bot 會提示你上傳轉帳截圖與 UID 末四碼。",
    "",
    "若你尚未轉帳，請依照以下方式完成付款：",
    "",
    RENEWAL_OFFER,
    "",
    "完成轉帳後，再點下方按鈕開始補傳。",
  ].join("\n");
}

function renewalReminderMessage(member: Member) {
  if (member.status === "active_paid" || member.status === "sent_7day_survey") {
    return [
      "你的訂閱將在 7 天內到期。",
      "",
      "到期時 Bot 會再次詢問是否續訂。",
      "若你已決定續訂，也可點擊下方按鈕提前開始訂閱申請。",
    ].join("\n");
  }

  return [
    "你的體驗期將在 7 天內到期。",
    "",
    "訂閱方案：",
    "3 個月 100U，1 個月 50U。（目前沒有年訂閱方案）",
    "",
    "到期時 Bot 會再次詢問是否續訂。",
  ].join("\n");
}

function sevenDayTrialSurveyMessage() {
  return [
    "你的 30 天體驗期將在 7 天後到期。",
    "請確認目前是否已翻倉成功。",
  ].join("\n");
}

function subscriptionInfoMessage() {
  return [
    "你的訂閱將在 3 天內到期。",
    "",
    "訂閱方案：",
    "3 個月 100U，1 個月 50U。（目前沒有年訂閱方案）",
    "",
    "可以使用交易所內部轉帳給小夏：",
    "MEXC - UID：77242747",
    "",
    "若你已決定續訂，可點擊下方按鈕提前開始。",
    "若你暫時不續訂，也請點擊「暫時不續訂」，助理才不用再人工追蹤確認。",
  ].join("\n");
}

function membershipExpiredRenewalMessage() {
  return [
    "你的訂閱已到期。",
    "",
    RENEWAL_OFFER,
    "",
    "請確認是否要訂閱並繼續留在群組。",
    "若你暫時不續訂，也請點擊「暫時不續訂」，助理才不用再人工追蹤確認。",
  ].join("\n\n");
}

function expiredKickMessage() {
  return [
    "你的訂閱已到期，系統已自動將你移出群組。",
    "",
    "若你因忙碌遺漏、或已完成轉帳但未及時完成審核，請點擊下方按鈕重新提交憑證申請恢復訂閱。",
  ].join("\n");
}

function graduationMessage() {
  return "畢業快樂！若日後想重新加入，歡迎隨時聯絡助理。";
}

function pnlQuestion() {
  return "請直接回覆目前的合約收益概略即可，並附上簡單的文字描述現況";
}

function renewalOfferQuestion() {
  return [
    "收到，感謝你分享目前的操作狀況。",
    "請確認是否要轉成續費的收費會員方案。",
    "若你暫時不續留，也請點擊「暫時不續留」，助理才不用再人工追蹤確認。",
  ].join("\n");
}

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
    ...(member.tradingView ? { tradingViewAccess: "待撤銷" } : {}),
  });
  await sendMessage(chatId, RENEWAL_EXPIRED_MESSAGE);
}

async function expirePaymentPendingMember(
  member: Member,
  chatId: string | number,
  now: Date,
) {
  await kickChatMember(member.telegramUserId);
  await updateMember(member.pageId, {
    status: "expired",
    kickReason: "payment_deadline_missed",
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Payment proof submitted after deadline",
    ...(member.tradingView ? { tradingViewAccess: "待撤銷" } : {}),
  });
  await sendMessage(chatId, PAYMENT_EXPIRED_MESSAGE);
}

function isEarlyRenewalEligible(member: Member, now: Date): boolean {
  return isRenewalNoticeCandidate(member, now, {
    allowAlreadyReminded: true,
  });
}

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

async function markCallbackSelection(
  query: TelegramCallbackQuery,
  selectedLabel: string,
  nextStepText = "",
) {
  const message = query.message;
  if (!message?.text) return;

  const selectedLine = `✅ 你已選擇：${selectedLabel}`;
  const nextStepLine = nextStepText ? `下一步：${nextStepText}` : "";
  const selectionBlock = nextStepLine
    ? [selectedLine, nextStepLine].join("\n")
    : selectedLine;
  const text = message.text.includes("✅ 你已選擇：")
    ? message.text
    : [message.text, "", selectionBlock].join("\n");

  await editMessageText(message.chat.id, message.message_id, text).catch(
    () => undefined,
  );
}

function addTag(tags: string[], tag: string): string[] {
  return tags.includes(tag) ? tags : [...tags, tag];
}

async function sendPaymentRequest(
  member: Member,
  chatId: string | number,
  now: Date,
  deadline?: Date,
) {
  const config = getRuntimeConfig();
  const actualDeadline =
    deadline ??
    (member.reviewDueAt
      ? new Date(member.reviewDueAt)
      : addDays(now, config.paymentGraceDays));
  await updateMember(member.pageId, {
    status: "payment_pending",
    renewalStep: "payment_pending",
    paymentDeadlineAt: isoDateTime(actualDeadline),
    paymentUidLast4: "",
    paymentProofFileId: "",
    paymentProofSubmittedAt: null,
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Payment request sent",
  });
  await sendMessage(
    chatId,
    [
      "已收到你的續費申請，請依照以下方式完成付款。",
      "",
      "續費方案：",
      "收費方式：",
      "3個月100U，一個月50U。（目前沒有年訂閱方案）",
      "",
      "可以使用交易所內部轉帳給小夏：",
      "MEXC - UID：77242747",
      "",
      "完成轉帳後，請直接在這個 Bot 對話上傳轉帳截圖，並在同一則訊息的文字說明或下一則訊息輸入 UID 末四碼（4 位數字）。",
      "你可以傳：截圖 + caption：UID 末四碼 1234；或先傳截圖，再傳 1234。",
      "兩項都收到後，助理確認後會更新你的會籍狀態。",
    ].join("\n"),
  );
}

function proofFileIdFromMessage(message: TelegramMessage): string {
  if (message.photo?.length) {
    return message.photo.at(-1)!.file_id;
  }
  if (message.document?.mime_type?.startsWith("image/")) {
    return message.document.file_id;
  }
  return "";
}

function paymentUidLast4FromMessage(message: TelegramMessage): string {
  const text = message.caption || message.text || "";
  return text.match(/(?:^|\D)(\d{4})(?!\d)/)?.[1] || "";
}

async function handlePaymentProofMessage(
  member: Member,
  message: TelegramMessage,
  now: Date,
) {
  if (isPast(member.paymentDeadlineAt, now)) {
    await expirePaymentPendingMember(member, message.chat.id, now);
    return;
  }

  const nextProofFileId =
    proofFileIdFromMessage(message) || member.paymentProofFileId;
  const nextUidLast4 =
    paymentUidLast4FromMessage(message) || member.paymentUidLast4;
  const patch: Partial<Member> = {
    lastBotCheckAt: isoDateTime(now),
  };

  if (proofFileIdFromMessage(message)) {
    patch.paymentProofFileId = proofFileIdFromMessage(message);
    patch.paymentProofSubmittedAt = isoDateTime(now);
  }
  if (paymentUidLast4FromMessage(message)) {
    patch.paymentUidLast4 = paymentUidLast4FromMessage(message);
  }

  if (!nextProofFileId && !nextUidLast4) {
    await sendMessage(message.chat.id, PAYMENT_PROOF_INSTRUCTIONS);
    return;
  }

  if (!nextProofFileId) {
    await updateMember(member.pageId, {
      ...patch,
      lastBotMessage: "Payment UID last 4 captured; awaiting screenshot",
    });
    await sendMessage(message.chat.id, "已收到 UID 末四碼，請再上傳轉帳截圖。");
    return;
  }

  if (!nextUidLast4) {
    await updateMember(member.pageId, {
      ...patch,
      lastBotMessage: "Payment screenshot captured; awaiting UID last 4",
    });
    await sendMessage(
      message.chat.id,
      "已收到轉帳截圖，請再回覆 UID 末四碼（4 位數字）。",
    );
    return;
  }

  await updateMember(member.pageId, {
    ...patch,
    paymentProofFileId: nextProofFileId,
    paymentUidLast4: nextUidLast4,
    paymentProofSubmittedAt: member.paymentProofSubmittedAt || isoDateTime(now),
    lastBotMessage: "Payment proof submitted",
  });
  await sendMessage(
    message.chat.id,
    "已收到你的轉帳截圖與 UID 末四碼，助理確認後會更新你的會籍狀態。",
  );
}

async function refuseAccess(chatId: number, reason: string) {
  await sendMessage(
    chatId,
    [
      `目前無法提供入群連結：${reason}`,
      "請點擊下方按鈕聯絡小夏協助確認名單資料。",
    ].join("\n\n"),
    teacherContactKeyboard(),
  );
}

function hasVerifiedMexcUid(member: Member): boolean {
  return (
    member.exchangeRegistered && Boolean(normalizeExchangeUid(member.exchangeUid))
  );
}

function needsMexcUidCollection(member: Member): boolean {
  return (
    (member.status === "eligible" ||
      member.status === "collecting_info" ||
      member.status === "invite_sent" ||
      member.status === "join_pending") &&
    !hasVerifiedMexcUid(member)
  );
}

function mexcUidFromMessage(message: TelegramMessage): string {
  const text = (message.text || message.caption || "").trim();
  return text.match(/\d{5,}/)?.[0] || "";
}

async function createInviteForMember(
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

async function handleMexcUidMessage(
  member: Member,
  message: TelegramMessage,
  now: Date,
) {
  const config = getRuntimeConfig();
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

  let referral: Awaited<ReturnType<typeof getMexcDirectSubaffiliate>>;
  try {
    referral = await getMexcDirectSubaffiliate(submittedUid, now);
  } catch (error) {
    await updateMember(member.pageId, {
      status: "collecting_info",
      exchangeUid: submittedUid,
      uidSubmittedAt: isoDateTime(now),
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "MEXC UID verification failed",
    });
    await refuseAccess(
      message.chat.id,
      "目前無法確認 MEXC UID，請聯絡小夏協助人工確認。",
    );
    return;
  }

  if (!referral) {
    await updateMember(member.pageId, {
      status: "collecting_info",
      exchangeUid: submittedUid,
      uidSubmittedAt: isoDateTime(now),
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "MEXC UID not found",
    });
    await refuseAccess(
      message.chat.id,
      "查不到這個 MEXC UID，請聯絡小夏協助確認。",
    );
    return;
  }

  if (!mexcDepositMeetsMinimum(referral, config.mexcMinDepositUsdt)) {
    await updateMember(member.pageId, {
      status: "collecting_info",
      exchangeRegistered: true,
      exchangeName: "MEXC",
      exchangeUid: submittedUid,
      uidSubmittedAt: isoDateTime(now),
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "MEXC deposit below minimum",
    });
    await refuseAccess(
      message.chat.id,
      `入金金額未達 ${config.mexcMinDepositUsdt} USDT，請聯絡小夏協助確認。`,
    );
    return;
  }

  await updateMember(member.pageId, {
    status: "eligible",
    exchangeRegistered: true,
    exchangeName: "MEXC",
    exchangeUid: submittedUid,
    uidSubmittedAt: isoDateTime(now),
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "MEXC UID and deposit verified",
  });
  await createInviteForMember(
    {
      ...member,
      status: "eligible",
      exchangeRegistered: true,
      exchangeName: "MEXC",
      exchangeUid: submittedUid,
      telegramUsername: usernameFromMessage(message) || member.telegramUsername,
    },
    message.chat.id,
    now,
  );
}

async function handleUidMessage(message: TelegramMessage, now: Date) {
  if (!message.from) return;
  const member = await findMemberByTelegramId(userId(message.from.id));
  if (!member) {
    await handleStart(message, now);
    return;
  }

  if (member.status === "payment_pending") {
    await handlePaymentProofMessage(member, message, now);
    return;
  }

  if (needsMexcUidCollection(member)) {
    await handleMexcUidMessage(member, message, now);
    return;
  }

  if (
    member.status === "sent_7day_survey" &&
    member.renewalStep === "awaiting_pnl"
  ) {
    const finalPnl = (message.text || "").trim();
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
    await sendMessage(
      message.chat.id,
      renewalOfferQuestion(),
      renewalKeyboard(),
    );
    return;
  }

  await handleStart(message, now);
}

const renewalDecisionStatuses = new Set([
  "sent_7day_survey",
  "sent_3day_offer",
  "renewal_due",
]);

async function handleCallback(query: TelegramCallbackQuery, now: Date) {
  if (!query.data) return;

  const member = await findMemberByTelegramId(userId(query.from.id));
  if (!member) {
    await answerCallbackQuery(query.id, "目前找不到你的會員資料", true);
    await refuseAccess(
      query.from.id,
      "你不在目前的 Notion 名單內，或表單上的 Telegram username 與目前帳號不一致。",
    );
    return;
  }

  if (query.data === "payment_proof:start") {
    if (member.status !== "payment_pending") {
      await answerCallbackQuery(query.id, "這個按鈕已不是目前可操作的步驟", true);
      await sendMessage(query.from.id, STALE_STEP_MESSAGE);
      return;
    }
    if (isPast(member.paymentDeadlineAt, now)) {
      await answerCallbackQuery(query.id, "付款回覆期限已過", true);
      await expirePaymentPendingMember(member, query.from.id, now);
      return;
    }

    await answerCallbackQuery(query.id, "請上傳轉帳截圖，並輸入 UID 末四碼。", true);
    await markCallbackSelection(
      query,
      "我已完成轉帳，補傳付款資料",
      "請在這個 Bot 對話上傳轉帳截圖，並輸入 UID 末四碼。",
    );
    await sendMessage(query.from.id, PAYMENT_PROOF_INSTRUCTIONS);
    return;
  }

  if (
    query.data === "trial_result:success" ||
    query.data === "trial_result:not_yet"
  ) {
    if (
      member.status !== "sent_7day_survey" ||
      member.renewalStep !== "awaiting_trial_result"
    ) {
      await answerCallbackQuery(query.id, "這個按鈕已不是目前可操作的步驟", true);
      await sendMessage(query.from.id, STALE_STEP_MESSAGE);
      return;
    }

    const selectedLabel =
      query.data === "trial_result:success" ? "我已經翻倉成功" : "尚未翻倉成功";
    await answerCallbackQuery(query.id, `已收到：${selectedLabel}`);
    await markCallbackSelection(query, selectedLabel);
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
    if (member.status === "payment_pending") {
      await answerCallbackQuery(
        query.id,
        "你已在付款流程中。完成轉帳後，請直接上傳轉帳截圖與 UID 末四碼。",
      );
      await sendMessage(query.from.id, PAYMENT_PROOF_INSTRUCTIONS);
      return;
    }
    if (renewalDecisionStatuses.has(member.status)) {
      await answerCallbackQuery(
        query.id,
        "已收到：繼續訂閱。完成轉帳後，請在 Bot 對話上傳轉帳截圖與 UID 末四碼。",
        true,
      );
      await markCallbackSelection(
        query,
        "繼續訂閱",
        "請查看下方付款資訊；完成轉帳後，上傳轉帳截圖與 UID 末四碼。",
      );
      await sendPaymentRequest(member, query.from.id, now);
      await sendMessage(query.from.id, PAYMENT_PROOF_INSTRUCTIONS);
      return;
    }

    await answerCallbackQuery(query.id, "這個按鈕已不是目前可操作的步驟", true);
    await sendMessage(query.from.id, STALE_STEP_MESSAGE);
    return;
  }

  if (query.data === "renewal:leave") {
    if (!renewalDecisionStatuses.has(member.status)) {
      await answerCallbackQuery(query.id, "這個按鈕已不是目前可操作的步驟", true);
      await sendMessage(query.from.id, STALE_STEP_MESSAGE);
      return;
    }

    await answerCallbackQuery(query.id, "已收到：暫時不續訂");
    await markCallbackSelection(query, "暫時不續訂");
    await updateMember(member.pageId, {
      status: "user_refused",
      renewalStep: "completed",
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "User declined renewal, kept until expiry",
    });
    await sendMessage(
      query.from.id,
      "已收到，你的群組資格將保留到到期日為止，到期後系統會自動移出。",
    );
    return;
  }

  if (query.data === "rejoin_apply") {
    if (member.status !== "expired") {
      await answerCallbackQuery(query.id, "這個按鈕已不是目前可操作的步驟", true);
      await sendMessage(query.from.id, STALE_STEP_MESSAGE);
      return;
    }
    const config = getRuntimeConfig();
    const deadline = addDays(now, config.paymentGraceDays);
    await updateMember(member.pageId, {
      status: "payment_pending",
      renewalStep: "payment_pending",
      paymentDeadlineAt: isoDateTime(deadline),
      paymentUidLast4: "",
      paymentProofFileId: "",
      paymentProofSubmittedAt: null,
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "Rejoin application submitted",
    });
    await answerCallbackQuery(query.id, "已收到補件申請");
    await sendMessage(
      query.from.id,
      [
        "已收到申請，請依照以下方式完成付款。",
        "",
        RENEWAL_OFFER,
        "",
        "完成轉帳後，請直接在這個 Bot 對話上傳轉帳截圖，並輸入 UID 末四碼（4 位數字）。",
      ].join("\n"),
    );
    await sendMessage(query.from.id, PAYMENT_PROOF_INSTRUCTIONS);
    return;
  }

  await answerCallbackQuery(query.id, "這個按鈕已不是目前可操作的步驟", true);
  await sendMessage(query.from.id, STALE_STEP_MESSAGE);
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
        ...(member.tradingView ? { tradingViewAccess: "待撤銷" } : {}),
      });
    }
    return;
  }

  await updateMember(member.pageId, {
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Group membership observed as valid",
  });
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  now = new Date(),
) {
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
  const members = await listMembers({ limit: 500 });
  const results: Array<{ pageId: string; action: string }> = [];

  for (const member of members) {
    // Order 1: renewal_due grace expired → kick
    if (member.status === "renewal_due" && isPast(member.reviewDueAt, now)) {
      await kickChatMember(member.telegramUserId);
      await updateMember(member.pageId, {
        status: "expired",
        kickReason: "renewal_not_confirmed",
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: "Removed: renewal_due past reviewDueAt",
        ...(member.tradingView ? { tradingViewAccess: "待撤銷" } : {}),
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
        ...(member.tradingView ? { tradingViewAccess: "待撤銷" } : {}),
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
        ...(member.tradingView ? { tradingViewAccess: "待撤銷" } : {}),
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
  }

  return results;
}
