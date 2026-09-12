import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiscordDetails, DiscordSummary } from "@/app/admin/components/DiscordSummary";

const verified = {
  discordId: "1524807192434311390",
  discordVerifiedAt: "2026-09-12T08:30:00.000Z",
  discordRole: "飛行員",
};

describe("Discord records in the admin UI", () => {
  it.each(["探索者", "宇航員", "飛行員"])("shows verification and the recorded %s role", (discordRole) => {
    const html = renderToStaticMarkup(createElement(DiscordSummary, { member: { ...verified, discordRole } }));
    expect(html).toContain("已驗證");
    expect(html).toContain(`身分組：${discordRole}`);
    expect(html).toContain("資料來源：Notion");
  });

  it("keeps verification when the role has no record", () => {
    const html = renderToStaticMarkup(createElement(DiscordSummary, { member: { ...verified, discordRole: null } }));
    expect(html).toContain("已驗證");
    expect(html).toContain("尚無身分組紀錄");
  });

  it.each([
    { discordId: "", discordVerifiedAt: null },
    { discordId: "   ", discordVerifiedAt: "   " },
  ])("does not infer verification from an existing role", (record) => {
    const html = renderToStaticMarkup(createElement(DiscordSummary, { member: { ...verified, ...record } }));
    expect(html).toContain("無驗證紀錄");
    expect(html).toContain("身分組：飛行員");
  });

  it.each([
    { discordId: "", discordVerifiedAt: verified.discordVerifiedAt },
    { discordId: verified.discordId, discordVerifiedAt: null },
    { discordId: verified.discordId, discordVerifiedAt: "invalid-date" },
    { discordId: "", discordVerifiedAt: "invalid-date" },
  ])("marks partial or invalid verification records as incomplete", (record) => {
    const html = renderToStaticMarkup(createElement(DiscordSummary, { member: { ...verified, ...record } }));
    expect(html).toContain("驗證資料不完整");
    expect(html).not.toContain("已驗證");
  });

  it("shows the exact ID and the verification date in Taipei time in details", () => {
    const html = renderToStaticMarkup(createElement(DiscordDetails, { member: verified }));
    expect(html).toContain(verified.discordId);
    expect(html).toContain("2026年9月12日 下午4:30");
  });

  it("renders invalid dates without breaking the detail page", () => {
    const html = renderToStaticMarkup(createElement(DiscordDetails, { member: { ...verified, discordVerifiedAt: "invalid-date" } }));
    expect(html).toContain("日期格式異常");
    expect(html).toContain("驗證資料不完整");
  });

  it("escapes role names from Notion", () => {
    const html = renderToStaticMarkup(createElement(DiscordSummary, { member: { ...verified, discordRole: "<script>alert(1)</script>" } }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
