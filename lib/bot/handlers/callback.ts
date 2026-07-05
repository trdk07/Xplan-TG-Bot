import { getRuntimeConfig } from "@/lib/config";
import { addDays, isPast, isoDateTime } from "@/lib/dates";
import { findMemberByTelegramId, updateMember } from "@/lib/notion";
import {
  type TelegramCallbackQuery,
  answerCallbackQuery,
  editMessageText,
  sendMessage,
} from "@/lib/telegram";
import { refuseAccess } from "@/lib/bot/invite";
import { expirePaymentPendingMember, sendPaymentRequest } from "@/lib/bot/handlers/payment";
import {
  PAYMENT_PROOF_INSTRUCTIONS,
  RENEWAL_OFFER,
  STALE_STEP_MESSAGE,
  pnlQuestion,
} from "@/lib/bot/messages";
import { addTag, FLIP_SUCCESS_TAG, userId } from "@/lib/bot/utils";

const renewalDecisionStatuses = new Set([
  "sent_7day_survey",
  "sent_3day_offer",
  "renewal_due",
]);

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
