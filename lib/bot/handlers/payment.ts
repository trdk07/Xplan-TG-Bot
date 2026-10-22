import { getRuntimeConfig } from "@/lib/config";
import { addDays, isPast, isoDateTime } from "@/lib/dates";
import { type Member, updateMember } from "@/lib/notion";
import { nonExpiringStatuses } from "@/lib/status";
import { isPaymentPending } from "@/lib/member-state";
import { type TelegramMessage, sendMessage } from "@/lib/telegram";
import { PAYMENT_EXPIRED_MESSAGE, PAYMENT_PROOF_INSTRUCTIONS, PAYMENT_REVIEW_PENDING_MESSAGE, STALE_STEP_MESSAGE } from "@/lib/bot/messages";

/** Keep complete submissions in the review queue when the submission window closes. */
export function hasSubmittedPaymentProof(member: Member): boolean {
  if (!isPaymentPending(member) || !member.paymentProofFileId || !member.paymentUidLast4) return false;
  if (!member.paymentProofSubmittedAt || !member.paymentDeadlineAt) return true;
  const submitted = Date.parse(member.paymentProofSubmittedAt);
  const deadline = Date.parse(member.paymentDeadlineAt);
  // Legacy records lacking usable submission metadata need manual review, not deletion.
  return !Number.isFinite(submitted) || !Number.isFinite(deadline) || submitted <= deadline;
}

export async function expirePaymentPendingMember(
  member: Member,
  chatId: string | number,
  now: Date,
) {
  if (member.status === "kicked" || member.status === "denied") {
    await sendMessage(chatId, STALE_STEP_MESSAGE);
    return;
  }
  if (hasSubmittedPaymentProof(member)) {
    await sendMessage(chatId, PAYMENT_REVIEW_PENDING_MESSAGE);
    return;
  }
  await updateMember(member.pageId, {
    ...(!nonExpiringStatuses.has(member.status) && isPast(member.reviewDueAt, now) ? { status: "expired" as const } : {}),
    renewalStep: "payment_expired",
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Payment proof submitted after deadline",
  });
  await sendMessage(chatId, PAYMENT_EXPIRED_MESSAGE);
}

export async function sendPaymentRequest(
  member: Member,
  chatId: string | number,
  now: Date,
  deadline?: Date,
) {
  if (member.status === "kicked" || member.status === "denied") {
    await sendMessage(chatId, STALE_STEP_MESSAGE);
    return;
  }
  if (hasSubmittedPaymentProof(member)) {
    await sendMessage(chatId, PAYMENT_REVIEW_PENDING_MESSAGE);
    return;
  }
  const config = getRuntimeConfig();
  const actualDeadline =
    deadline ??
    (member.reviewDueAt && !isPast(member.reviewDueAt, now)
      ? new Date(member.reviewDueAt)
      : addDays(now, config.paymentGraceDays));
  await updateMember(member.pageId, {
    status: nonExpiringStatuses.has(member.status) ? member.status : member.status === "expired" || isPast(member.reviewDueAt, now) ? "expired" : "payment_pending",
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

export function proofFileIdFromMessage(message: TelegramMessage): string {
  if (message.photo?.length) {
    return message.photo.at(-1)!.file_id;
  }
  if (message.document?.mime_type?.startsWith("image/")) {
    return message.document.file_id;
  }
  return "";
}

export function paymentUidLast4FromMessage(message: TelegramMessage): string {
  const text = message.caption || message.text || "";
  return text.match(/(?:^|\D)(\d{4})(?!\d)/)?.[1] || "";
}

export async function handlePaymentProofMessage(
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
