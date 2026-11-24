import { expect, it } from "vitest";
import { describeDailyIssue, formatDailyReport } from "@/lib/bot/daily-report";
import {
  isUndeliverableTelegramError,
  notificationKindLabel,
  pageIdFromNotificationKey,
} from "@/lib/evidence-store";

const now = new Date("2026-11-10T01:00:00Z");

it("sends nothing when every member was handled", () => {
  expect(
    formatDailyReport(
      [{ pageId: "p", action: "qualification_checked" }],
      now,
    ),
  ).toBeNull();
});
it("groups problems by plain-language reason and names members by username", () => {
  const text = formatDailyReport(
    [
      { pageId: "a", label: "@alice", action: "error", detail: "通知傳送結果不明，需要人工覆核" },
      { pageId: "b", label: "@bob", action: "error", detail: "Duplicate bound account requires review" },
      { pageId: "c", label: "@carol", action: "error", detail: "duplicate_account_requires_review" },
      { pageId: "d", label: "@dave", action: "needs_data", detail: "x" },
      { pageId: "e", label: "@erin", action: "qualification_checked" },
    ],
    now,
  )!;
  expect(text).toContain("共檢查 5 人，需要你處理 3 人");
  expect(text).toContain("【通知不確定有沒有送到】1 人\n@alice");
  expect(text).toContain("【交易所帳號重複（兩位會員綁了同一個 UID）】2 人\n@bob、@carol");
  expect(text).toContain("待確認通知");
  expect(text).toContain("另有 1 人缺少交易所或 UID");
  expect(text).not.toContain("35350abc");
});
it("keeps unknown errors visible for the maintainer", () => {
  expect(describeDailyIssue("something odd").fix).toContain("something odd");
});
it("recognises Telegram errors that prove a message cannot be delivered", () => {
  expect(isUndeliverableTelegramError(new Error("Forbidden: bot was blocked by the user"))).toBe(true);
  expect(isUndeliverableTelegramError(new Error("Bad Request: chat not found"))).toBe(true);
  expect(isUndeliverableTelegramError(new Error("network timeout"))).toBe(false);
  expect(isUndeliverableTelegramError(new Error("Too Many Requests: retry after 5"))).toBe(false);
});
it("reads the member and notification kind from an outbox key", () => {
  const key = `paid_expiry:35350abc-cc15-818a-a08e-dc5400870650:${Date.parse("2026-07-07")}`;
  expect(pageIdFromNotificationKey(key)).toBe("35350abc-cc15-818a-a08e-dc5400870650");
  expect(notificationKindLabel(key)).toBe("付費到期通知");
  expect(notificationKindLabel("reminder:p:1:3day")).toBe("到期前 3 天提醒");
});
it("reports an exchange API outage once instead of as 62 manual reviews", () => {
  const mexc = Array.from({ length: 62 }, (_, i) => ({
    pageId: `m${i}`,
    label: `@mexc${i}`,
    exchange: "Mexc（抹茶）",
    action: "error",
    detail: "Admission verification requires operator review: upstream_http_400",
  }));
  const text = formatDailyReport(
    [
      ...mexc,
      { pageId: "o", label: "@okx_user", exchange: "OKX", action: "error", detail: "Admission verification requires operator review: pagination_incomplete" },
      { pageId: "ok", label: "@fine", action: "qualification_checked" },
    ],
    now,
  )!;
  expect(text).toContain("共檢查 64 人，需要你處理 1 人；另有 62 人受交易所 API 問題影響");
  expect(text).toContain("🔧【MEXC API 查詢失敗：交易所 API 回應錯誤（HTTP 400）】62 人");
  expect(text).toContain("@mexc0、@mexc1、@mexc2、@mexc3、@mexc4 等 62 人");
  expect(text).not.toContain("@mexc5、");
  expect(text).toContain("不是會員的問題");
  expect(text).toContain("【入群資格（推薦關係／入金）需人工確認】1 人\n@okx_user");
});
it("keeps volume API failures separate per exchange", () => {
  const issue = describeDailyIssue("Volume verification: upstream_rejected; retained last successful evidence", "bitget");
  expect(issue.systemic).toBe(true);
  expect(issue.title).toContain("Bitget API 查詢失敗");
});
it("reports a missing MEXC referral separately from a credential failure", () => {
  const text = formatDailyReport([
    { pageId: "a", label: "@referral", exchange: "MEXC", action: "error",
      detail: "Admission verification requires operator review: mexc_referral_not_found" },
    { pageId: "b", label: "@volume", exchange: "MEXC", action: "error",
      detail: "Volume verification: mexc_referral_not_found; retained last successful evidence" },
    { pageId: "c", label: "@api", exchange: "MEXC", action: "error",
      detail: "Admission verification requires operator review: upstream_rejected" },
  ], now)!;
  expect(text).toContain("需要你處理 2 人；另有 1 人受交易所 API 問題影響");
  expect(text).toContain("【MEXC 推薦資料待核對】2 人\n@referral、@volume");
  expect(text).toContain("核對綁定的 UID");
  expect(text).toMatch(/🔧【MEXC API 查詢失敗：[^\n]+】1 人\n@api/);
});
