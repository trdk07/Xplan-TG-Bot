import {
  accountRebindPatch,
  findAccountOwner,
  sameBoundAccount,
} from "@/lib/account-rebind";
import { getEvidenceStore, type EvidenceStore } from "@/lib/evidence-store";
import { ExchangeClient } from "@/lib/exchanges";
import {
  admissionDecision,
  amountAtLeast,
  exchangeLabel,
  normalizeExchange,
  sumAmounts,
  type Exchange,
} from "@/lib/membership-v2";
import {
  getMemberByPageId,
  listMembers,
  updateMember,
  type Member,
} from "@/lib/notion";
import { qualificationError, recheckQualifications } from "@/lib/qualification";
import {
  answerCallbackQuery,
  revokeChatInviteLink,
  sendForceReply,
  sendMessage,
  type TelegramCallbackQuery,
  type TelegramMessage,
} from "@/lib/telegram";
import { teacherContactKeyboard } from "@/lib/bot/keyboards";
import {
  REBIND_START_CALLBACK,
  escapeHtml,
  registrationGuideButton,
  UID_LOCATION_HINT,
} from "@/lib/bot/v2-messages";

/**
 * Self-service exchange rebind. The new account is verified first (referral and
 * 100 USDT cumulative deposit); only a verified account replaces the binding, so
 * a typo or an account outside our referral never loses the current binding.
 */

const REBIND_EXCHANGE_PREFIX = "rebind:exchange:";
const EXCHANGES = ["mexc", "bitget", "okx"] as const;

export const REBIND_RULES_MESSAGE = [
  "🔄 <b>更換綁定交易所</b>",
  "想改用其他交易所累積交易量，可以在這裡換綁。請先確認：",
  "1. 新帳號必須透過我們的推薦連結註冊（MEXC／Bitget／OKX）。還沒註冊請先點下方「前往報名頁（註冊＋填表）」。",
  "2. 新帳號的歷史累積入金需達 100 USDT。",
  "3. 交易量只計算目前綁定的帳號，新舊帳號不會合併計算。",
  "4. 付費期限會保留，換綁不需要重新付費。",
  "5. 換綁後要到 Discord 用新的交易所和 UID 重新驗證；重新驗證前，Discord 身分組可能暫時變成「探索者」。",
  "",
  "系統會先查新帳號，<b>符合條件才會換綁</b>；不符合時，目前的綁定不會改變。",
  "請選擇新帳號的交易所：",
].join("\n");

const PROMPT_PATTERN = /更換綁定：請回覆新的 (MEXC|Bitget|OKX) UID/;

export function rebindPrompt(exchange: Exchange) {
  return [
    `更換綁定：請回覆新的 ${exchangeLabel(exchange)} UID（只填數字）`,
    "",
    UID_LOCATION_HINT,
  ].join("\n");
}

/** The exchange a reply is answering, when the member replied to a rebind prompt. */
export function rebindExchangeFromReply(
  message: TelegramMessage,
): Exchange | null {
  const label = message.reply_to_message?.text?.match(PROMPT_PATTERN)?.[1];
  return label ? normalizeExchange(label) : null;
}

const blocked = (member: Member) =>
  ["suspended", "kicked", "denied"].includes(member.status);

async function refuse(chatId: number | string, text: string, withGuide = false) {
  await sendMessage(chatId, text, [
    ...(withGuide ? [registrationGuideButton()] : []),
    ...teacherContactKeyboard(),
  ]);
}

export async function handleRebindCallback(
  query: TelegramCallbackQuery,
  member: Member,
) {
  if (blocked(member)) {
    await answerCallbackQuery(query.id, "會員權益已停用，請聯絡助理。", true);
    return;
  }
  if (query.data === REBIND_START_CALLBACK) {
    await answerCallbackQuery(query.id);
    await sendMessage(query.from.id, REBIND_RULES_MESSAGE, [
      EXCHANGES.map((key) => ({
        text: exchangeLabel(key),
        callback_data: `${REBIND_EXCHANGE_PREFIX}${key}`,
      })),
      registrationGuideButton(),
    ]);
    return;
  }
  const exchange = normalizeExchange(
    query.data?.replace(REBIND_EXCHANGE_PREFIX, "") || "",
  );
  if (!exchange) {
    await answerCallbackQuery(query.id, "請重新選擇交易所", true);
    return;
  }
  await answerCallbackQuery(query.id, `請回覆新的 ${exchangeLabel(exchange)} UID`);
  await sendForceReply(query.from.id, rebindPrompt(exchange), "新帳號 UID");
}

export function isRebindCallback(data: string | undefined) {
  return (
    data === REBIND_START_CALLBACK ||
    Boolean(data?.startsWith(REBIND_EXCHANGE_PREFIX))
  );
}

type RebindDeps = {
  read: typeof getMemberByPageId;
  list: typeof listMembers;
  write: typeof updateMember;
  store: Pick<
    EvidenceStore,
    "withQualificationLock" | "reserveAccount" | "recordDeposits" | "depositTotal"
  >;
  client: Pick<ExchangeClient, "admission">;
  revokeInvite: (link: string) => Promise<unknown>;
  recheck: (pageId: string, now: Date) => Promise<unknown>;
};

export type RebindResult =
  | { kind: "rebound"; member: Member }
  | { kind: "same_account" }
  | { kind: "duplicate" }
  | { kind: "not_qualified" }
  | { kind: "needs_review"; reason: string };

/** Verify the candidate account, then rebind under the member lease. */
export async function rebindAccount(
  pageId: string,
  exchange: Exchange,
  uid: string,
  now: Date,
  deps: RebindDeps,
): Promise<RebindResult> {
  const result = await deps.store.withQualificationLock(pageId, async (guard) => {
    const member = await deps.read(pageId);
    if (!member) throw new Error("Member not found");
    if (
      normalizeExchange(member.exchangeName) === exchange &&
      member.exchangeUid === uid
    )
      return { kind: "same_account" } as const;
    if (findAccountOwner(await deps.list(), pageId, exchange, uid))
      return { kind: "duplicate" } as const;
    let admission;
    try {
      const evidence = await deps.client.admission(exchange, uid);
      await deps.store.recordDeposits(exchange, uid, evidence.events);
      const ledger = await deps.store.depositTotal(exchange, uid);
      const proven = amountAtLeast(evidence.cumulative, ledger)
        ? evidence.cumulative
        : ledger;
      sumAmounts([proven]);
      const decision = admissionDecision(
        null,
        evidence.referral,
        proven,
        evidence.complete,
      );
      if (decision === "not_qualified") return { kind: "not_qualified" } as const;
      if (decision === "needs_review")
        return { kind: "needs_review", reason: "deposit_history_incomplete" } as const;
      admission = {
        verifiedDepositUsdt: Number(proven),
        depositEvidenceComplete: evidence.complete,
      };
    } catch (error) {
      return { kind: "needs_review", reason: qualificationError(error) } as const;
    }
    await guard();
    try {
      await deps.store.reserveAccount(pageId, exchange, uid);
    } catch {
      return { kind: "duplicate" } as const;
    }
    const fresh = await deps.read(pageId);
    if (!fresh || !sameBoundAccount(member, fresh))
      throw new Error("account_changed_during_rebind");
    if (fresh.inviteLink) await deps.revokeInvite(fresh.inviteLink);
    const patch = accountRebindPatch(
      fresh,
      exchange,
      uid,
      now,
      "member self-service",
      admission,
    );
    await guard();
    await deps.write(pageId, patch);
    return { kind: "rebound", member: { ...fresh, ...patch } as Member } as const;
  });
  if (result.kind === "rebound") {
    // Best effort: fill in the new account's volume now instead of at 09:00.
    await deps.recheck(pageId, now).catch(() => undefined);
  }
  return result;
}

async function defaultDeps(now: Date): Promise<RebindDeps> {
  return {
    read: getMemberByPageId,
    list: listMembers,
    write: updateMember,
    store: await getEvidenceStore(),
    client: new ExchangeClient(process.env, fetch, now),
    revokeInvite: revokeChatInviteLink,
    recheck: recheckQualifications,
  };
}

export function rebindSuccessMessage(member: Member) {
  return [
    `✅ <b>已換綁為 ${escapeHtml(member.exchangeName)} UID ${escapeHtml(member.exchangeUid)}</b>`,
    "付費期限保留不變；交易量從現在起依新帳號計算（每天台北時間 09:00 更新）。",
    "",
    "⚠️ <b>請到 Discord 重新驗證</b>：在驗證頻道點「驗證現有會員」，填入：",
    `・交易所：${escapeHtml(member.exchangeName)}`,
    `・UID：${escapeHtml(member.exchangeUid)}`,
    `・Email：${escapeHtml(member.email || "報名時填寫的 Email")}`,
    "重新驗證前，Discord 身分組可能暫時是「探索者」。",
  ].join("\n");
}

export async function handleRebindUid(
  member: Member,
  exchange: Exchange,
  message: TelegramMessage,
  now: Date,
  deps?: RebindDeps,
) {
  const chatId = message.chat.id;
  if (blocked(member)) {
    await refuse(chatId, "會員權益已停用，請聯絡助理。");
    return;
  }
  const uid = (message.text || "").trim();
  if (!/^\d{1,32}$/.test(uid)) {
    await sendForceReply(
      chatId,
      ["UID 只能填數字，請再回覆一次。", "", rebindPrompt(exchange)].join("\n"),
      "新帳號 UID",
    );
    return;
  }
  await sendMessage(chatId, "正在查詢新帳號，請稍候…");
  let result: RebindResult;
  try {
    result = await rebindAccount(
      member.pageId,
      exchange,
      uid,
      now,
      deps ?? (await defaultDeps(now)),
    );
  } catch {
    await refuse(
      chatId,
      "目前有其他作業正在處理你的會員資料，請稍後再試；目前的綁定沒有改變。",
    );
    return;
  }
  const label = `${exchangeLabel(exchange)} UID ${escapeHtml(uid)}`;
  if (result.kind === "rebound") {
    await sendMessage(chatId, rebindSuccessMessage(result.member));
    return;
  }
  if (result.kind === "same_account") {
    await sendMessage(chatId, `你目前已綁定 ${label}，不需要換綁。`);
    return;
  }
  if (result.kind === "duplicate") {
    await refuse(
      chatId,
      `${label} 已綁定其他會員，無法換綁。若這是你的帳號，請聯絡小夏協助確認。目前的綁定沒有改變。`,
    );
    return;
  }
  if (result.kind === "not_qualified") {
    await refuse(
      chatId,
      [
        `❌ ${label} 尚未符合換綁條件，目前的綁定沒有改變。`,
        "可能原因：",
        "・這個帳號不是透過我們的推薦連結註冊",
        "・該帳號的歷史累積入金尚未達 100 USDT",
        "",
        "請點下方「前往報名頁（註冊＋填表）」，用推薦連結註冊新帳號；入金達標後再點「更換綁定交易所」重試。",
      ].join("\n"),
      true,
    );
    return;
  }
  await (deps?.write ?? updateMember)(member.pageId, {
    lastBotCheckAt: now.toISOString(),
    lastBotMessage: `Self-service rebind needs review: ${exchangeLabel(exchange)} ${uid} (${result.reason})`,
  }).catch(() => undefined);
  await refuse(
    chatId,
    [
      `⏳ 目前無法自動確認 ${label}，已記錄你的換綁申請，請聯絡小夏協助處理。`,
      "這不是不合格判定；目前的綁定沒有改變。",
    ].join("\n"),
  );
}
