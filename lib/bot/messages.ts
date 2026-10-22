import type { Member } from "@/lib/notion";
import { formatDateTime } from "@/lib/dates";

export const RENEWAL_OFFER = [
  "續費方案：",
  "收費方式：",
  "3個月100U，一個月50U。（目前沒有年訂閱方案）",
  "",
  "可以使用交易所內部轉帳給小夏：",
  "MEXC - UID：77242747",
].join("\n");

export const PAYMENT_PROOF_INSTRUCTIONS =
  "下一步：請上傳轉帳截圖，並在這個 Bot 對話輸入 UID 末四碼（4 位數字）。可以把 UID 末四碼寫在圖片說明，或下一則訊息傳 4 位數字。";

export const STALE_STEP_MESSAGE =
  "這個按鈕已不是目前可操作的步驟。若需要協助，請聯絡助理確認。";

export const PAYMENT_EXPIRED_MESSAGE =
  "付款回覆期限已過，系統已停止此付款流程。Telegram 群組仍會保留；若已完成轉帳或需要協助，請聯絡助理。";

export const PAYMENT_REVIEW_PENDING_MESSAGE =
  "你的完整付款資料已收到，正在等待助理審核，請勿重複申請。Telegram 群組仍會保留。";

export const MEXC_UID_MESSAGE =
  "請回覆你的 MEXC UID。Bot 會確認這個 UID 是否已透過我們的 MEXC 註冊連結完成註冊，並確認入金金額是否達 100 USDT。";

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

export function renewalReminderMessage(member: Member, stage: "7day" | "3day" = "7day") {
  const days = stage === "3day" ? 3 : 7;
  return [
    `你的會籍將在 ${days} 天內到期。`,
    `到期時間：${formatDateTime(member.reviewDueAt)}`,
    "",
    "到期後會籍將標記為已到期，Telegram 群組仍會保留，不會自動移出。",
    "若你已決定續訂，可點擊下方按鈕開始申請；付款資料由助理人工審核。",
  ].join("\n");
}

export function membershipExpiredMessage(member: Member) {
  return [
    "你的會籍已到期。",
    `到期時間：${formatDateTime(member.reviewDueAt)}`,
    "",
    "Telegram 群組仍會保留，不會自動移出。",
    "若想恢復訂閱，可點擊下方按鈕提交付款資料，由助理審核。",
  ].join("\n");
}
