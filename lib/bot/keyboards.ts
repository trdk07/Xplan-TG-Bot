import { getRuntimeConfig } from "@/lib/config";

export function teacherContactKeyboard() {
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

export function renewalKeyboard() {
  return [
    [
      { text: "繼續訂閱", callback_data: "renewal:stay" },
      { text: "暫時不續訂", callback_data: "renewal:leave" },
    ],
  ];
}

export function rejoinKeyboard() {
  return [[{ text: "申請恢復訂閱", callback_data: "rejoin_apply" }]];
}

export function trialResultKeyboard() {
  return [
    [
      { text: "我已經翻倉成功", callback_data: "trial_result:success" },
      { text: "尚未翻倉成功", callback_data: "trial_result:not_yet" },
    ],
  ];
}

export function earlyRenewalKeyboard() {
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
