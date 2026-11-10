import type { Member } from "@/lib/notion";
import type { InlineKeyboardButton } from "@/lib/telegram";
import { exchangeLabel, normalizeExchange } from "@/lib/membership-v2";

/** Guided V2 onboarding copy. Messages are sent with Telegram parse_mode=HTML. */

export const RULES_ACK_CALLBACK = "onboarding:rules_ack";

export const DEFAULT_APPLICATION_FORM_URL =
  "https://x-plan-sage.vercel.app/apply";

/** The website apply page also explains how to register with each exchange. */
export function applicationFormUrl() {
  return process.env.APPLICATION_FORM_URL || DEFAULT_APPLICATION_FORM_URL;
}

export function registrationGuideButton(): InlineKeyboardButton[] {
  return [{ text: "前往報名頁（註冊＋填表）", url: applicationFormUrl() }];
}

/** For members already in Notion: the apply page only for its referral links. */
export function referralLinksButton(): InlineKeyboardButton[] {
  return [{ text: "查看交易所推薦註冊連結", url: applicationFormUrl() }];
}

// Shown to members already in Notion, so they need the referral links, not the form.
const REGISTRATION_GUIDE_NOTE =
  "還沒用推薦連結註冊交易所？點下方「查看交易所推薦註冊連結」。你已經填過報名表，不用重填；如果註冊的帳號跟報名表上的不同，驗證時請點「更換綁定交易所」。";

// The website refuses a second submission with different data for the same
// identity (HTTP 409), so existing members switch accounts via rebind instead.
const RETRY_REGISTRATION_NOTE =
  "還沒用推薦連結註冊？點下方「查看交易所推薦註冊連結」。如果你已經用推薦連結註冊了另一個帳號，<b>不用重新填報名表</b>，請點「更換綁定交易所」換成新帳號。";
export const PAYMENT_UPGRADE_CALLBACK = "payment:upgrade";

/** The same paid-upgrade entry point is offered wherever the member reads the rules or the Discord guide. */
export function paymentUpgradeButton(): InlineKeyboardButton[] {
  return [{ text: "我要付費升級", callback_data: PAYMENT_UPGRADE_CALLBACK }];
}

/** Same payment request as an upgrade, worded for people who have not joined yet. */
export function directPayButton(): InlineKeyboardButton[] {
  return [
    { text: "不註冊，直接付費加入", callback_data: PAYMENT_UPGRADE_CALLBACK },
  ];
}

export const UNSUPPORTED_EXCHANGE_MESSAGE = [
  "你的報名資料不是 MEXC、Bitget 或 OKX 的帳號，沒辦法自動審核免費入群。你可以：",
  "1. <b>直接付費加入</b>：點「不註冊，直接付費加入」，付款確認後就能入群。",
  "2. <b>改走免費入群</b>：用我們的推薦連結註冊 MEXC／Bitget／OKX，再點「更換綁定交易所」填新帳號的 UID。",
].join("\n");

export const REBIND_START_CALLBACK = "rebind:start";

export function rebindButton(): InlineKeyboardButton[] {
  return [{ text: "更換綁定交易所", callback_data: REBIND_START_CALLBACK }];
}

export function discordGuideKeyboard(): InlineKeyboardButton[][] {
  return [paymentUpgradeButton(), rebindButton()];
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const V2_WELCOME_RULES = [
  "👋 <b>歡迎來到 Xplan！</b>",
  "這裡是入群審核，大約 3 分鐘就能完成。開始前請先看完以下規則：",
  "",
  "📌 <b>入群規則</b>",
  "1. 需使用我們的推薦連結註冊 MEXC、Bitget 或 OKX。",
  `　${REGISTRATION_GUIDE_NOTE}`,
  "2. 該帳號的歷史累積入金需達 100 USDT（站內入金也算）。",
  "3. <b>審核通過後，資金提領或轉走都不影響資格</b>，不需要一直放在交易所。",
  "4. 通過後即可加入 Telegram 群組，並取得 Discord 邀請。TG 群組與 Discord 免費資源不會因到期被移出。",
  "",
  "🚀 <b>想升級成「宇航員」？</b>",
  "・付費訂閱，或",
  "・同一個交易所帳號近 30 天現貨＋合約交易量達 200,000 USDT。",
  "升級後在 Discord 完成驗證，身分組會自動同步。",
  "",
  "💳 <b>不想註冊交易所？可以直接付費加入</b>",
  "點下方「不註冊，直接付費加入」，付款經助理確認後，就會收到 Telegram 入群連結和 Discord 邀請，不需要推薦註冊或入金審核。",
  "",
  "要走免費入群，看完請點下方「我了解，開始驗證」。",
].join("\n");

export function rulesAckKeyboard(): InlineKeyboardButton[][] {
  return [
    [{ text: "我了解，開始驗證", callback_data: RULES_ACK_CALLBACK }],
    directPayButton(),
    referralLinksButton(),
  ];
}

export const EXCHANGE_SELECTION_MESSAGE = [
  "<b>步驟 1／2：選擇交易所</b>",
  "請選擇你報名時註冊的交易所（需與報名資料相同）。",
].join("\n");

export function exchangeSelectionKeyboard(): InlineKeyboardButton[][] {
  return [
    (["mexc", "bitget", "okx"] as const).map((key) => ({
      text: exchangeLabel(key),
      callback_data: `exchange:confirm:${key}`,
    })),
  ];
}

export const UID_LOCATION_HINT =
  "🔎 <b>UID 在哪裡？</b>\n打開交易所 App，點頭像進入個人中心，名稱附近的一串數字就是 UID。";

export function uidRequestMessage(exchangeName: string) {
  return [
    "<b>步驟 2／2：回覆 UID</b>",
    `已確認 ${escapeHtml(exchangeName)}。請直接在這裡回覆報名時填寫的 UID（只填數字）。`,
    "",
    UID_LOCATION_HINT,
  ].join("\n");
}

export const UID_MISMATCH_MESSAGE = [
  "UID 必須與報名時綁定的交易所帳號一致，請核對後再回覆一次（只填數字）。",
  "",
  UID_LOCATION_HINT,
  "",
  "若想改用其他交易所的帳號，請點下方「更換綁定交易所」；報名資料填錯也可以聯絡小夏協助更正。",
].join("\n");

export function admissionPassedMessage(inviteLink: string) {
  return [
    "✅ <b>審核通過！</b>",
    "這是你的專屬 Telegram 入群連結（24 小時內有效，僅限本人使用，請勿轉傳）：",
    inviteLink,
    "",
    "點連結後送出入群申請，系統會自動核准。",
    "提醒：資金之後提領或轉走，都不影響已通過的資格。",
  ].join("\n");
}

export const ADMISSION_NEEDS_REVIEW_MESSAGE = [
  "⏳ <b>已列入助理覆核</b>",
  "目前查詢資料不足，或交易所暫時無法查詢。這不是不合格判定，助理確認後會再通知你。",
  "急著處理可以點下方聯絡小夏。",
].join("\n");

export const ADMISSION_NOT_MET_MESSAGE = [
  "❌ <b>尚未符合入群條件</b>",
  "可能原因：",
  "・這個 UID 不是透過我們的推薦連結註冊",
  "・該帳號的歷史累積入金尚未達 100 USDT",
  "",
  RETRY_REGISTRATION_NOTE,
  "完成後回到這裡按 /start 重新驗證。若確定已符合條件仍無法通過，請聯絡小夏。",
].join("\n");

function discordLink() {
  const url = process.env.DISCORD_INVITE_URL;
  return url ? escapeHtml(url) : "Discord 邀請連結尚未設定，請聯絡助理索取。";
}

/** Discord onboarding guide; reminds the member of the identity fields the DC form asks for. */
export function discordGuideMessage(member: Member, intro: string) {
  const exchange = normalizeExchange(member.exchangeName || "");
  const exchangeName = exchange
    ? exchangeLabel(exchange)
    : member.exchangeName || "報名時的交易所";
  return [
    intro,
    "",
    "👉 <b>下一步：加入 Discord</b>",
    discordLink(),
    "",
    "📖 <b>Discord 怎麼用</b>",
    "1. 點上方連結加入伺服器，完成伺服器規則確認。",
    "2. 約 10 分鐘內會自動取得「探索者」，免費資源不需要驗證就能使用。",
    "3. 已付費或交易量達標的會員，到驗證頻道點「驗證現有會員」，選擇交易所並輸入 UID 和 Email，即可取得「宇航員」。",
    "想付費升級，可以點下方「我要付費升級」；想改用其他交易所累積交易量，可以點「更換綁定交易所」。",
    "",
    "📝 <b>請記下你的驗證資料（Discord 驗證要用）</b>",
    `・交易所：${escapeHtml(exchangeName)}`,
    `・UID：${escapeHtml(member.exchangeUid || "報名時填寫的 UID")}`,
    `・Email：${escapeHtml(member.email || "報名時填寫的 Email")}`,
    "Email 必須和報名時填寫的一樣；若忘記或需要更正，請聯絡小夏。",
  ].join("\n");
}

export const JOIN_APPROVED_INTRO =
  "🎉 <b>入群申請已通過！</b>Telegram 群組會持續保留，不會因到期被移出。";

export const ALREADY_JOINED_INTRO =
  "你已有 Telegram 入群紀錄，社群資格不受付費到期影響。";
