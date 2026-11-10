import {
  type Member,
  findMemberByTelegramId,
  updateMember,
} from "@/lib/notion";
import { getEvidenceStore } from "@/lib/evidence-store";
import { recheckQualifications } from "@/lib/qualification";
import { normalizeExchange, exchangeLabel } from "@/lib/membership-v2";
import {
  sendMessage,
  createChatInviteLink,
  unbanChatMember,
  approveChatJoinRequest,
  declineChatJoinRequest,
  revokeChatInviteLink,
  type TelegramMessage,
  type TelegramChatJoinRequest,
  type TelegramCallbackQuery,
  type InlineKeyboardButton,
  answerCallbackQuery,
} from "@/lib/telegram";
import { teacherContactKeyboard } from "@/lib/bot/keyboards";
import {
  ADMISSION_NEEDS_REVIEW_MESSAGE,
  ADMISSION_NOT_MET_MESSAGE,
  ALREADY_JOINED_INTRO,
  EXCHANGE_SELECTION_MESSAGE,
  JOIN_APPROVED_INTRO,
  UID_MISMATCH_MESSAGE,
  V2_WELCOME_RULES,
  admissionPassedMessage,
  discordGuideKeyboard,
  rebindButton,
  referralLinksButton,
  discordGuideMessage,
  exchangeSelectionKeyboard,
  rulesAckKeyboard,
  uidRequestMessage,
} from "@/lib/bot/v2-messages";

const special = (member: Member) =>
  ["partner", "exempt", "VIP"].includes(member.status);
const blocked = (member: Member) =>
  ["suspended", "kicked", "denied"].includes(member.status);
async function refuse(
  chatId: number | string,
  text: string,
  extraButtons: InlineKeyboardButton[][] = [],
) {
  await sendMessage(chatId, text, [...extraButtons, ...teacherContactKeyboard()]);
}
export async function createV2Invite(
  member: Member,
  chatId: number | string,
  now: Date,
) {
  if (
    blocked(member) ||
    (!member.admissionVerifiedAt && !special(member) && !member.groupJoinedAt)
  ) {
    await refuse(
      chatId,
      "尚未確認推薦關係與歷史累積入金滿100 USDT，請聯絡助理覆核。",
    );
    return;
  }
  if (!member.telegramUserId) throw new Error("Telegram identity missing");
  await unbanChatMember(member.telegramUserId);
  const expiry = new Date(now.getTime() + 86400000);
  const invite = await createChatInviteLink({
    name: `user-${member.telegramUserId}`.slice(0, 32),
    expireDate: expiry,
  });
  await updateMember(member.pageId, {
    onboardingStep: "join_pending",
    inviteLink: invite.invite_link,
    inviteExpiresAt: expiry.toISOString(),
    lastBotCheckAt: now.toISOString(),
    lastBotMessage: "Verified community invitation sent; no trial created",
  });
  await sendMessage(chatId, admissionPassedMessage(invite.invite_link));
}
export async function handleV2Start(
  member: Member,
  message: TelegramMessage,
  now: Date,
) {
  if (blocked(member)) {
    await refuse(
      message.chat.id,
      "會員權益已停用，請聯絡助理；原有社群資格保留。",
    );
    return;
  }
  if (member.groupJoinedAt) {
    await sendMessage(
      message.chat.id,
      discordGuideMessage(member, ALREADY_JOINED_INTRO),
      discordGuideKeyboard(),
    );
    return;
  }
  if (
    member.inviteLink &&
    member.inviteExpiresAt &&
    Date.parse(member.inviteExpiresAt) > now.getTime()
  ) {
    await sendMessage(
      message.chat.id,
      `你的專屬入群連結仍有效：\n${member.inviteLink}`,
    );
    return;
  }
  if (member.admissionVerifiedAt || special(member)) {
    await createV2Invite(member, message.chat.id, now);
    return;
  }
  const exchange = normalizeExchange(member.exchangeName);
  if (!exchange) {
    await refuse(
      message.chat.id,
      "報名資料缺少有效交易所。請點下方「更換綁定交易所」選擇你用推薦連結註冊的交易所並填 UID，或聯絡小夏協助。",
      [rebindButton()],
    );
    return;
  }
  await sendMessage(message.chat.id, V2_WELCOME_RULES, rulesAckKeyboard());
}
/** Second guided step: the member acknowledged the rules, so ask for the exchange. */
export async function handleV2RulesAck(
  query: TelegramCallbackQuery,
  member: Member,
  now: Date,
) {
  if (blocked(member)) {
    await answerCallbackQuery(query.id, "會員權益已停用，請聯絡助理。", true);
    return;
  }
  await answerCallbackQuery(query.id, "請選擇報名時註冊的交易所");
  if (member.groupJoinedAt) {
    await sendMessage(
      query.from.id,
      discordGuideMessage(member, ALREADY_JOINED_INTRO),
      discordGuideKeyboard(),
    );
    return;
  }
  if (member.admissionVerifiedAt || special(member)) {
    await createV2Invite(member, query.from.id, now);
    return;
  }
  if (!normalizeExchange(member.exchangeName)) {
    await refuse(
      query.from.id,
      "報名資料缺少有效交易所。請點下方「更換綁定交易所」選擇你用推薦連結註冊的交易所並填 UID，或聯絡小夏協助。",
      [rebindButton()],
    );
    return;
  }
  await sendMessage(
    query.from.id,
    EXCHANGE_SELECTION_MESSAGE,
    exchangeSelectionKeyboard(),
  );
}
export async function handleV2Exchange(
  query: TelegramCallbackQuery,
  member: Member,
) {
  const selected = query.data?.replace("exchange:confirm:", "");
  const expected = normalizeExchange(member.exchangeName);
  if (blocked(member)) {
    await answerCallbackQuery(query.id, "會員權益已停用，請聯絡助理。", true);
    return;
  }
  if (selected !== expected) {
    await answerCallbackQuery(
      query.id,
      "這不是你報名紀錄中的交易所。",
      true,
    );
    await sendMessage(
      query.from.id,
      `你的報名紀錄是 ${expected ? exchangeLabel(expected) : "未填交易所"}。如果想改用其他交易所的帳號，請點下方「更換綁定交易所」。`,
      [rebindButton(), ...teacherContactKeyboard()],
    );
    return;
  }
  await answerCallbackQuery(query.id, "請回覆你的交易所 UID");
  await sendMessage(query.from.id, uidRequestMessage(exchangeLabel(expected!)));
}
export async function handleV2Uid(
  member: Member,
  message: TelegramMessage,
  now: Date,
) {
  if (blocked(member)) {
    await refuse(message.chat.id, "會員權益已停用，請聯絡助理。");
    return;
  }
  const uid = (message.text || "").trim();
  if (!/^\d{1,32}$/.test(uid) || uid !== member.exchangeUid) {
    await refuse(message.chat.id, UID_MISMATCH_MESSAGE, [rebindButton()]);
    return;
  }
  const updated = await recheckQualifications(member.pageId, now);
  if (updated.admissionVerifiedAt) {
    await createV2Invite(updated, message.chat.id, now);
    return;
  }
  await refuse(
    message.chat.id,
    updated.onboardingStep === "needs_review"
      ? ADMISSION_NEEDS_REVIEW_MESSAGE
      : ADMISSION_NOT_MET_MESSAGE,
    updated.onboardingStep === "needs_review"
      ? undefined
      : [referralLinksButton(), rebindButton()],
  );
}
export async function handleV2Join(
  request: TelegramChatJoinRequest,
  now: Date,
) {
  const member = await findMemberByTelegramId(String(request.from.id));
  const valid =
    member &&
    !blocked(member) &&
    (member.admissionVerifiedAt || special(member) || member.groupJoinedAt) &&
    member.inviteLink &&
    member.inviteLink === request.invite_link?.invite_link &&
    member.inviteExpiresAt &&
    Date.parse(member.inviteExpiresAt) > now.getTime();
  if (!valid || !member) {
    await declineChatJoinRequest(request.from.id);
    return;
  }
  await approveChatJoinRequest(request.from.id);
  await revokeChatInviteLink(member.inviteLink!);
  await updateMember(member.pageId, {
    onboardingStep: "joined",
    groupJoinedAt: member.groupJoinedAt || now.toISOString(),
    inviteLink: null,
    inviteExpiresAt: null,
    lastBotCheckAt: now.toISOString(),
    lastBotMessage: "Community admission approved without trial",
  });
  const store = await getEvidenceStore();
  const result = await store.deliverOnce(
    `discord-invitation:${member.pageId}`,
    () =>
      sendMessage(
        request.user_chat_id,
        discordGuideMessage(member, JOIN_APPROVED_INTRO),
        discordGuideKeyboard(),
      ),
  );
  if (result === "held")
    throw new Error("Discord invitation delivery needs operator review");
}
