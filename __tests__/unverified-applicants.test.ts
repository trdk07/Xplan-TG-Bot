import { expect, it } from "vitest";
import { formatDailyReport } from "@/lib/bot/daily-report";
import { unverifiedApplicants } from "@/lib/unverified-applicants";

const now = new Date("2026-11-21T01:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const member = (changes: Record<string, unknown>) =>
  ({ pageId: "p", telegramUserId: "", telegramUsername: "@x", groupJoinedAt: null, status: "free", createdAt: daysAgo(8), ...changes }) as any;

it("lists applications older than seven days that never reached the bot", () => {
  const found = unverifiedApplicants(
    [
      member({ pageId: "old", createdAt: daysAgo(20) }),
      member({ pageId: "week", createdAt: daysAgo(7) }),
      member({ pageId: "recent", createdAt: daysAgo(6) }),
      member({ pageId: "started", telegramUserId: "123" }),
      member({ pageId: "joined", groupJoinedAt: daysAgo(30) }),
      member({ pageId: "partner", status: "partner" }),
      member({ pageId: "unknown-date", createdAt: null }),
    ],
    now,
  );
  expect(found.map((item) => [item.member.pageId, item.days])).toEqual([["old", 20], ["week", 7]]);
});
it("adds an unverified line to a report that is already being sent", () => {
  const text = formatDailyReport(
    [
      { pageId: "e", label: "@err", action: "error", detail: "通知傳送結果不明，需要人工覆核" },
      { pageId: "a", label: "@late", action: "qualification_checked", unverifiedDays: 12 },
    ],
    now,
  )!;
  expect(text).toContain("📋 有 1 人填表超過 7 天還沒到機器人驗證（不算錯誤）：@late（12 天）");
  expect(text).toContain("已報名未驗證");
  expect(text).toContain("需要你處理 1 人");
});
it("sends a report on the day someone crosses seven days, then stays quiet", () => {
  const onDay = (days: number) =>
    formatDailyReport([{ pageId: "a", label: "@late", action: "unverified_applicant", unverifiedDays: days }], now);
  expect(onDay(7)).toContain("@late（7 天）");
  expect(onDay(7)).toContain("共檢查 0 人");
  expect(onDay(8)).toBeNull();
});
