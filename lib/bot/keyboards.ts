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

export function renewalKeyboard(dueAt?: string | null) {
  const period = dueAt && Number.isFinite(Date.parse(dueAt)) ? `:${Date.parse(dueAt)}` : "";
  return [
    [
      { text: "繼續訂閱", callback_data: `renewal:stay${period}` },
      { text: "暫時不續訂", callback_data: `renewal:leave${period}` },
    ],
  ];
}

export function rejoinKeyboard() {
  return [[{ text: "申請恢復訂閱", callback_data: "rejoin_apply" }]];
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
