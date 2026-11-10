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
  expect(text).toContain("共檢查 5 人，需要處理 3 人");
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
