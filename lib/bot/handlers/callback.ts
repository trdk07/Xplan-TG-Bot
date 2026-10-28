import { v2Enabled } from "@/lib/membership-v2";
import { handleV2Exchange } from "@/lib/bot/v2";
import { getRuntimeConfig } from "@/lib/config";
import { addDays, isPast, isoDateTime } from "@/lib/dates";
import { isPaymentPending, isRenewalNoticeCandidate } from "@/lib/member-state";
import { findMemberByTelegramId, updateMember } from "@/lib/notion";
import {
  type TelegramCallbackQuery,
  answerCallbackQuery,
  editMessageText,
  sendMessage,
} from "@/lib/telegram";
import { refuseAccess } from "@/lib/bot/invite";
import {
  expirePaymentPendingMember,
  hasSubmittedPaymentProof,
  sendPaymentRequest,
} from "@/lib/bot/handlers/payment";
import {
  PAYMENT_PROOF_INSTRUCTIONS,
  PAYMENT_REVIEW_PENDING_MESSAGE,
  STALE_STEP_MESSAGE,
} from "@/lib/bot/messages";
import { normalizeBotMember } from "@/lib/bot/member-policy";
import { userId } from "@/lib/bot/utils";

export async function markCallbackSelection(
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

export async function handleCallback(query: TelegramCallbackQuery, now: Date) {
  if (!query.data) return;
  const record = await findMemberByTelegramId(userId(query.from.id));
  if (!record) {
    await answerCallbackQuery(query.id, "目前找不到你的會員資料", true);
    await refuseAccess(
      query.from.id,
      "你不在目前的 Notion 名單內，或表單上的 Telegram username 與目前帳號不一致。",
    );
    return;
  }
  if (v2Enabled() && query.data.startsWith("exchange:confirm:"))
    return handleV2Exchange(query, record);
  // Retired survey buttons never revive the old questionnaire or collect P/L.
  if (query.data.startsWith("trial_result:")) {
    await rejectStaleCallback(query);
    return;
  }
  const member = await normalizeBotMember(record, now);
  if (
    member.status === "suspended" ||
    member.status === "kicked" ||
    member.status === "denied"
  ) {
    await rejectStaleCallback(query);
    return;
  }

  if (
    (query.data === "payment_proof:start" ||
      query.data === "rejoin_apply" ||
      query.data.startsWith("renewal:stay") ||
      query.data.startsWith("renewal:leave")) &&
    hasSubmittedPaymentProof(member)
  ) {
    await answerCallbackQuery(query.id, "付款資料已收到，等待助理審核");
    await sendMessage(query.from.id, PAYMENT_REVIEW_PENDING_MESSAGE);
    return;
  }

  if (query.data === "payment_proof:start") {
    if (!isPaymentPending(member)) {
      await rejectStaleCallback(query);
      return;
    }
    if (isPast(member.paymentDeadlineAt, now)) {
      await answerCallbackQuery(query.id, "付款回覆期限已過", true);
      await expirePaymentPendingMember(member, query.from.id, now);
      return;
    }
    await answerCallbackQuery(
      query.id,
      "請上傳轉帳截圖，並輸入 UID 末四碼。",
      true,
    );
    await markCallbackSelection(
      query,
      "我已完成轉帳，補傳付款資料",
      "請在這個 Bot 對話上傳轉帳截圖，並輸入 UID 末四碼。",
    );
    await sendMessage(query.from.id, PAYMENT_PROOF_INSTRUCTIONS);
    return;
  }

  const renewalAction = query.data.match(/^renewal:(stay|leave)(?::(\d+))?$/);
  if (renewalAction) {
    const [, choice, period] = renewalAction;
    if (period && Number(period) !== Date.parse(member.reviewDueAt || "")) {
      await rejectStaleCallback(query);
      return;
    }
    if (choice === "stay" && isPaymentPending(member)) {
      if (isPast(member.paymentDeadlineAt, now)) {
        await answerCallbackQuery(query.id, "付款回覆期限已過", true);
        await expirePaymentPendingMember(member, query.from.id, now);
        return;
      }
      await answerCallbackQuery(
        query.id,
        "你已在付款流程中，請上傳轉帳截圖與 UID 末四碼。",
      );
      await sendMessage(query.from.id, PAYMENT_PROOF_INSTRUCTIONS);
      return;
    }
    if (
      !isRenewalNoticeCandidate(member, now, { allowAlreadyReminded: true })
    ) {
      await rejectStaleCallback(query);
      return;
    }
    if (choice === "stay") {
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
    await answerCallbackQuery(query.id, "已收到：暫時不續訂");
    await markCallbackSelection(query, "暫時不續訂");
    await updateMember(member.pageId, {
      renewalStep: "declined",
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "User declined renewal; membership retained until expiry",
    });
    await sendMessage(
      query.from.id,
      "已記錄暫時不續訂。會籍保留到原到期日，Telegram 群組仍會保留，不會自動移出。",
    );
    return;
  }

  if (
    query.data === "rejoin_apply" &&
    (member.status === "expired" ||
      (v2Enabled() && ["free", "active_volume"].includes(member.status)))
  ) {
    if (isPaymentPending(member) && !isPast(member.paymentDeadlineAt, now)) {
      await answerCallbackQuery(
        query.id,
        "你已在付款流程中，請補上轉帳截圖與 UID 末四碼。",
      );
      await sendMessage(query.from.id, PAYMENT_PROOF_INSTRUCTIONS);
      return;
    }
    const deadline = addDays(now, getRuntimeConfig().paymentGraceDays);
    await answerCallbackQuery(query.id, "已收到恢復訂閱申請");
    await sendPaymentRequest(member, query.from.id, now, deadline);
    await sendMessage(query.from.id, PAYMENT_PROOF_INSTRUCTIONS);
    return;
  }
  await rejectStaleCallback(query);
}

async function rejectStaleCallback(query: TelegramCallbackQuery) {
  await answerCallbackQuery(query.id, "這個按鈕已不是目前可操作的步驟", true);
  await sendMessage(query.from.id, STALE_STEP_MESSAGE);
}
