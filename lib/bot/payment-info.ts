import { getRuntimeConfig } from "@/lib/config";
import { formatDateTime } from "@/lib/dates";
import { sendPhoto } from "@/lib/telegram";

/**
 * Single source of payment details shown to members. Messages are sent with
 * parse_mode=HTML; <code> lets Telegram users tap to copy UIDs and the address.
 */

export const PAYMENT_PLANS = [
  "・1 個月：50 USDT",
  "・3 個月：100 USDT",
  "（目前沒有年訂閱方案）",
].join("\n");

export const INTERNAL_TRANSFER_ACCOUNTS = [
  { exchange: "Bitget", uid: "3904055146" },
  { exchange: "OKX", uid: "606715251568316021" },
  { exchange: "Ourbit", uid: "21601021" },
  { exchange: "MEXC", uid: "77242747" },
] as const;

export const USDT_BEP20_ADDRESS = "0x3b91863cb0e71c37350c8de95fdf28a8f3cdd701";

/** Static asset in /public; its QR code encodes exactly USDT_BEP20_ADDRESS. */
export const USDT_BEP20_QR_PATH = "/payment/usdt-bep20-qr.png";

export const PAYMENT_METHODS = [
  "<b>付款方式（擇一）</b>",
  "1️⃣ 交易所站內轉帳給小夏",
  ...INTERNAL_TRANSFER_ACCOUNTS.map(
    ({ exchange, uid }) => `・${exchange} UID：<code>${uid}</code>`,
  ),
  "",
  "2️⃣ 鏈上轉帳 USDT",
  "・網路：<b>BEP20（BNB Smart Chain）</b>",
  `・地址：<code>${USDT_BEP20_ADDRESS}</code>`,
  "・QR Code 見下一張圖",
  "⚠️ 只能轉 USDT，且務必選 BEP20 網路；選錯網路或幣種將無法找回。",
].join("\n");

export const PAYMENT_PROOF_STEPS = [
  "<b>完成轉帳後</b>",
  "請在這個對話上傳轉帳截圖，並在圖片說明或下一則訊息輸入 4 位數字的 UID 末四碼：",
  "・站內轉帳：你轉出帳號的 UID 末四碼",
  "・鏈上轉帳：你報名綁定的交易所 UID 末四碼",
  "兩項都收到後，由助理審核並更新會籍。",
].join("\n");

export function paymentRequestMessage(options: {
  renewal: boolean;
  deadline?: string | null;
}) {
  return [
    options.renewal
      ? "已收到你的續費申請，請依照以下方式完成付款。"
      : "已開啟付費升級申請，請依照以下方式完成付款。",
    "",
    `💳 <b>${options.renewal ? "續費方案" : "付費方案"}</b>`,
    PAYMENT_PLANS,
    "",
    PAYMENT_METHODS,
    "",
    PAYMENT_PROOF_STEPS,
    ...(options.deadline
      ? [`付款資料請在 ${formatDateTime(options.deadline)} 前送出。`]
      : []),
  ].join("\n");
}

export const USDT_QR_CAPTION = [
  "USDT 鏈上轉帳 QR Code（BEP20）",
  `<code>${USDT_BEP20_ADDRESS}</code>`,
  "只能轉 USDT，務必選 BEP20 網路。",
].join("\n");

/** Best effort: the address is already in the text, so a failed image never blocks payment. */
export async function sendUsdtQrCode(chatId: string | number) {
  try {
    const { appBaseUrl } = getRuntimeConfig();
    if (!appBaseUrl) return;
    await sendPhoto(chatId, `${appBaseUrl}${USDT_BEP20_QR_PATH}`, USDT_QR_CAPTION);
  } catch (error) {
    console.error("USDT QR code delivery failed", error);
  }
}
