import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions");
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(), getAdminOperator: async () => "助理" }));
vi.mock("@/lib/notion", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/notion")>(), listMembers: vi.fn(), getMemberByPageId: vi.fn(),
}));
import AdminPage from "@/app/admin/page";
import TradingViewPage from "@/app/admin/tradingview/page";
import MemberDetailPage from "@/app/admin/member/[pageId]/page";
import { getMemberByPageId, listMembers, mapNotionPageToMember } from "@/lib/notion";

const item = { ...mapNotionPageToMember({ id: "page-1", properties: {} }),
  telegramUserId: "1001", telegramUsername: "@review-member", status: "expired" as const,
  reviewDueAt: "2026-05-01T00:00:00.000Z", groupJoinedAt: "2026-04-01T00:00:00.000Z",
  renewalStep: "payment_pending", paymentUidLast4: "1234", paymentProofFileId: "proof",
  paidAt: "2026-03-01T00:00:00.000Z", finalPnl: "retired-survey-answer",
  renewalReminderSentAt: "2026-04-24T00:00:00.000Z", renewalReminder3DaySentAt: "2026-04-28T00:00:00.000Z", renewalReminderDueAt: "2026-05-01T00:00:00.000Z",
};
beforeEach(() => {
  vi.mocked(listMembers).mockResolvedValue([item]);
  vi.mocked(getMemberByPageId).mockResolvedValue(item);
});

function savePreview(name: string, html: string) {
  const directory = process.env.LIFECYCLE_VISUAL_OUTPUT;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "globals.css"), readFileSync("app/globals.css"));
  writeFileSync(path.join(directory, name), `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="globals.css"><title>會籍流程後台驗收（測試資料）</title></head><body>${html}</body></html>`);
}

describe("admin membership lifecycle presentation", () => {
  it.each(["compact", "full"])("keeps expired payment-review members visible in %s view and distinguishes Telegram join history", async (density) => {
    const html = renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({ view: "payment_review_ready", density }) }));
    savePreview(`admin-${density}.html`, html);
    expect(html).toContain("@review-member");
    expect(html).toContain("會籍已到期");
    expect(html).toContain("曾加入 Telegram");
    expect(html).toContain("7 天續約提醒");
    expect(html).toContain("3 天續約提醒");
    expect(html).toContain("停用會籍");
    expect(html).not.toContain("踢出");
  });
  it("separates ambiguous unexpired TradingView memberships from confirmed trials", async () => {
    vi.mocked(listMembers).mockResolvedValue([
      { ...item, status: "trial_active", tradingView: "expired-trial" },
      { ...item, status: "sent_7day_survey", reviewDueAt: "2099-05-01T00:00:00.000Z", paidAt: null, groupJoinedAt: null, tradingView: "ambiguous-legacy" },
      { ...item, status: "active_paid", reviewDueAt: "2099-05-01T00:00:00.000Z", tradingView: "current-paid" },
    ]);
    const html = renderToStaticMarkup(await TradingViewPage());
    expect(html).toContain("current-paid");
    expect(html).not.toContain("expired-trial");
    expect(html).toContain("會籍類型待確認");
    expect(html).toContain("ambiguous-legacy");
    expect(html.match(/<h2>體驗期<\/h2>[\s\S]*?<\/section>/)?.[0]).not.toContain("ambiguous-legacy");
  });

  it("shows both reminder timestamps without retired survey answers or questionnaire actions", async () => {
    const html = renderToStaticMarkup(await MemberDetailPage({ params: Promise.resolve({ pageId: "page-1" }) }));
    savePreview("member.html", html);
    expect(html).toContain("7 天續約提醒");
    expect(html).toContain("3 天續約提醒");
    expect(html).toContain("Telegram 群組資格會保留");
    expect(html).not.toContain("retired-survey-answer");
    expect(html).not.toContain("踢出群組");
  });
});
