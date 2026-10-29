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
  answerCallbackQuery,
} from "@/lib/telegram";
import { teacherContactKeyboard } from "@/lib/bot/keyboards";

const special = (member: Member) =>
  ["partner", "exempt", "VIP"].includes(member.status);
const blocked = (member: Member) =>
  ["suspended", "kicked", "denied"].includes(member.status);
async function refuse(chatId: number | string, text: string) {
  await sendMessage(chatId, text, teacherContactKeyboard());
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
  await sendMessage(
    chatId,
    `資格已確認，這是你的專屬入群連結，請勿轉傳：\n${invite.invite_link}\nTelegram 群組與 Discord 免費資源沒有試用期限。`,
  );
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
      `你已有 Telegram 入群紀錄，社群資格不受付費到期影響。${process.env.DISCORD_INVITE_URL ? `\nDiscord：${process.env.DISCORD_INVITE_URL}` : "\nDiscord 邀請連結請向助理索取。"}`,
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
      "報名資料缺少有效交易所，請由助理核對綁定帳號。",
    );
    return;
  }
  await sendMessage(
    message.chat.id,
    "請確認報名時註冊的交易所，再回覆該交易所的 UID。會確認推薦關係與歷史累積入金100 USDT；之後提領不影響已通過的資格。",
    [
      [
        ...(["mexc", "bitget", "okx"] as const).map((key) => ({
          text: exchangeLabel(key),
          callback_data: `exchange:confirm:${key}`,
        })),
      ],
    ],
  );
}
export async function handleV2Exchange(
  query: TelegramCallbackQuery,
  member: Member,
) {
  const selected = query.data?.replace("exchange:confirm:", "");
  const expected = normalizeExchange(member.exchangeName);
  if (blocked(member) || selected !== expected) {
    await answerCallbackQuery(
      query.id,
      "請使用報名紀錄中的交易所；更換帳號須由助理處理。",
      true,
    );
    return;
  }
  await answerCallbackQuery(query.id, "請回覆你的交易所 UID");
  await sendMessage(
    query.from.id,
    `已確認 ${exchangeLabel(expected!)}，請回覆報名時填寫的 UID（只填數字）。`,
  );
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
    await refuse(
      message.chat.id,
      "UID 必須與報名時綁定的交易所帳號一致，請核對後再輸入。",
    );
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
      ? "目前資料不足或查詢暫不可用，已列入助理覆核；不會因為舊資料查不到就判定不合格。"
      : "尚未符合推薦關係或歷史累積入金100 USDT，請確認後再試。",
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
        `入群申請已通過！Telegram 群組及 Discord 免費資源會持續保留。\n${process.env.DISCORD_INVITE_URL ? `歡迎加入 Discord 並進行身分驗證：\n${process.env.DISCORD_INVITE_URL}` : "Discord 邀請連結尚未設定，請聯絡助理索取。"}`,
      ),
  );
  if (result === "held")
    throw new Error("Discord invitation delivery needs operator review");
}
