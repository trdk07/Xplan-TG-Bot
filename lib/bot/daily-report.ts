import { formatDateTime } from "@/lib/dates";
import { escapeHtml } from "@/lib/bot/v2-messages";
import { exchangeLabel, normalizeExchange } from "@/lib/membership-v2";
import { qualificationCodeLabel } from "@/lib/qualification-labels";
import { UNVERIFIED_AFTER_DAYS } from "@/lib/unverified-applicants";

export type ReportResult = {
  pageId: string;
  label?: string;
  exchange?: string;
  unverifiedDays?: number;
  action: string;
  detail?: string;
};

type Issue = { title: string; fix: string; systemic?: boolean };

/** Codes that mean the exchange API call itself failed, not this member. */
const API_FAILURE = /^(upstream_http_\d{3}|upstream_rejected|upstream_unavailable|credentials_missing|operation_budget_exceeded)$/;

function exchangeName(raw = "") {
  const exchange = normalizeExchange(raw);
  return exchange ? exchangeLabel(exchange) : raw || "交易所";
}

/** The exchange/qualification code carried at the end of a job detail. */
function detailCode(detail: string) {
  return detail
    .replace(/^(Admission verification requires operator review|Volume verification):\s*/, "")
    .split(";")[0]
    .trim();
}

/** Plain-language reason and next step for a daily-job failure detail. */
export function describeDailyIssue(detail = "", exchange = ""): Issue {
  const code = detailCode(detail);
  if (code === "mexc_referral_not_found")
    return {
      title: "MEXC 推薦資料待核對",
      fix: "請核對綁定的 UID 是否在 Xplan 的 MEXC 推薦名單。會員可在 TG Bot 換綁，已確認的入群資格及最近一次成功的交易量結果會保留。",
    };
  if (API_FAILURE.test(code))
    return {
      systemic: true,
      title: `${exchangeName(exchange)} API 查詢失敗：${qualificationCodeLabel(code)}`,
      fix: `這是系統問題，不是會員的問題，不用逐一處理。請學長檢查 ${exchangeName(exchange)} 的 API 金鑰與權限；修好後隔天會自動重查。已入群的會員不受影響。`,
    };
  if (detail.startsWith("Volume verification:"))
    return {
      title: "交易量查詢失敗（已保留上次成功的結果）",
      fix: "通常是交易所 API 暫時失敗，明天會自動重試；連續多天出現請學長檢查交易所 API 金鑰。",
    };
  if (detail.startsWith("Admission verification requires operator review:"))
    return {
      title: "入群資格（推薦關係／入金）需人工確認",
      fix: "到後台會員頁查看入金覆核原因，確認後用「歷史入金人工覆核」。",
    };
  if (/duplicate/i.test(detail))
    return {
      title: "交易所帳號重複（兩位會員綁了同一個 UID）",
      fix: "到 Notion 找出綁同一個 UID 的會員，確認正確的那位後，用後台「更換綁定交易所帳號」修正另一位。",
    };
  if (detail.includes("通知傳送結果不明"))
    return {
      title: "通知不確定有沒有送到",
      fix: "到後台首頁「待確認通知」確認後按「已處理」，系統就不會再提醒。",
    };
  if (detail.startsWith("Legacy payment evidence"))
    return {
      title: "舊付款紀錄需人工確認",
      fix: "到後台會員頁核對付款紀錄，必要時重新標記付款。",
    };
  if (/Notion (v2 |reminder )?fields missing/i.test(detail))
    return {
      title: "Notion 缺少系統欄位",
      fix: "請學長執行 Notion 欄位設定（membership:schema / notion:ensure-schema）。",
    };
  if (/changed_during|reset_during/.test(detail))
    return {
      title: "檢查時資料剛好被修改",
      fix: "不用處理，明天會自動重試。",
    };
  return { title: "其他錯誤", fix: `請學長查看。錯誤內容：${detail || "未知"}` };
}

/** Operator report grouped by problem, naming members by Telegram username. */
export function formatDailyReport(results: ReportResult[], now: Date) {
  const errors = results.filter((result) => result.action === "error");
  const unverified = results
    .filter((result) => typeof result.unverifiedDays === "number")
    .sort((a, b) => b.unverifiedDays! - a.unverifiedDays!);
  // Report on its own only on the day someone crosses the threshold, so a
  // quiet system is not messaged every morning about the same old application.
  const newlyUnverified = unverified.some(
    (result) => result.unverifiedDays === UNVERIFIED_AFTER_DAYS,
  );
  if (!errors.length && !newlyUnverified) return null;
  const groups = new Map<string, { issue: Issue; members: string[] }>();
  for (const error of errors) {
    const issue = describeDailyIssue(error.detail, error.exchange);
    const group = groups.get(issue.title) ?? { issue, members: [] };
    group.members.push(error.label || error.pageId);
    groups.set(issue.title, group);
  }
  const all = [...groups.values()];
  const personal = all.filter((group) => !group.issue.systemic);
  const systemic = all.filter((group) => group.issue.systemic);
  const count = (list: typeof all) =>
    list.reduce((sum, group) => sum + group.members.length, 0);
  const needsData = results.filter((result) => result.action === "needs_data");
  return [
    `⚠️ <b>每日會員檢查（${formatDateTime(now.toISOString())}）</b>`,
    `共檢查 ${results.filter((result) => result.action !== "unverified_applicant").length} 人，需要你處理 ${count(personal)} 人${
      systemic.length ? `；另有 ${count(systemic)} 人受交易所 API 問題影響` : ""
    }`,
    ...personal.flatMap(({ issue, members }) => [
      "",
      `【${issue.title}】${members.length} 人`,
      escapeHtml(members.join("、")),
      `→ ${escapeHtml(issue.fix)}`,
    ]),
    ...systemic.flatMap(({ issue, members }) => [
      "",
      `🔧【${issue.title}】${members.length} 人`,
      // One root cause: a long name list would only bury the real action.
      escapeHtml(
        members.slice(0, SYSTEMIC_NAME_LIMIT).join("、") +
          (members.length > SYSTEMIC_NAME_LIMIT
            ? ` 等 ${members.length} 人`
            : ""),
      ),
      `→ ${escapeHtml(issue.fix)}`,
    ]),
    ...(unverified.length
      ? [
          "",
          `📋 有 ${unverified.length} 人填表超過 ${UNVERIFIED_AFTER_DAYS} 天還沒到機器人驗證（不算錯誤）：${escapeHtml(
            unverified
              .slice(0, UNVERIFIED_NAME_LIMIT)
              .map((result) => `${result.label || result.pageId}（${result.unverifiedDays} 天）`)
              .join("、") +
              (unverified.length > UNVERIFIED_NAME_LIMIT
                ? ` 等 ${unverified.length} 人`
                : ""),
          )}`,
          "→ 到後台首頁「已報名未驗證」查看聯絡方式，提醒他們到機器人按 /start。",
        ]
      : []),
    ...(needsData.length
      ? [
          "",
          `📝 另有 ${needsData.length} 人缺少交易所或 UID（已在 Notion 標記，不算錯誤）：${escapeHtml(
            needsData.map((result) => result.label || result.pageId).join("、"),
          )}`,
        ]
      : []),
  ].join("\n");
}

const SYSTEMIC_NAME_LIMIT = 5;
const UNVERIFIED_NAME_LIMIT = 10;
