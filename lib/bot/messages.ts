import type { Member } from "@/lib/notion";

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

export const RENEWAL_EXPIRED_MESSAGE =
  "這次續費回覆期限已過，系統已停止此續費流程。若需要重新加入或續費，請聯絡助理。";

export const PAYMENT_EXPIRED_MESSAGE =
  "付款回覆期限已過，系統已停止此付款流程。若已完成轉帳或需要協助，請聯絡助理。";

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

export function renewalReminderMessage(member: Member) {
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

export function sevenDayTrialSurveyMessage() {
  return [
    "你的 30 天體驗期將在 7 天後到期。",
    "請確認目前是否已翻倉成功。",
  ].join("\n");
}

export function subscriptionInfoMessage() {
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

export function membershipExpiredRenewalMessage() {
  return [
    "你的訂閱已到期。",
    "",
    RENEWAL_OFFER,
    "",
    "請確認是否要訂閱並繼續留在群組。",
    "若你暫時不續訂，也請點擊「暫時不續訂」，助理才不用再人工追蹤確認。",
  ].join("\n\n");
}

export function expiredKickMessage() {
  return [
    "你的訂閱已到期，系統已自動將你移出群組。",
    "",
    "若你因忙碌遺漏、或已完成轉帳但未及時完成審核，請點擊下方按鈕重新提交憑證申請恢復訂閱。",
  ].join("\n");
}

export function graduationMessage() {
  return "畢業快樂！若日後想重新加入，歡迎隨時聯絡助理。";
}

export function pnlQuestion() {
  return "請直接回覆目前的合約收益概略即可，並附上簡單的文字描述現況";
}

export function renewalOfferQuestion() {
  return [
    "收到，感謝你分享目前的操作狀況。",
    "請確認是否要轉成續費的收費會員方案。",
    "若你暫時不續留，也請點擊「暫時不續留」，助理才不用再人工追蹤確認。",
  ].join("\n");
}
