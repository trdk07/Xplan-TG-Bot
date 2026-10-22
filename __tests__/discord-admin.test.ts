import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/actions");
vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(),
  getAdminOperator: vi.fn(async () => "小夏"),
}));
vi.mock("@/lib/notion", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/notion")>(),
  listMembers: vi.fn(),
  getMemberByPageId: vi.fn(),
}));

import AdminPage from "@/app/admin/page";
import MemberDetailPage from "@/app/admin/member/[pageId]/page";
import { requireAdmin } from "@/lib/auth";
import { getMemberByPageId, listMembers, mapNotionPageToMember } from "@/lib/notion";

const members = ["探索者", "宇航員", "飛行員", null, null, null].map((role, i) =>
  mapNotionPageToMember({
    id: `member-${i}`,
    properties: {
      "Telegram User ID": { rich_text: [{ plain_text: `10000000${i}` }] },
      "Telegram Username": { title: [{ plain_text: `測試會員 ${i + 1}` }] },
      Email: { email: `member${i + 1}@example.com` },
      Status: { select: { name: "partner" } },
      Discord_id: { rich_text: i === 4 ? [] : [{ plain_text: "1524807192434311390" }] },
      "Discord Verified At": { date: i >= 4 ? null : { start: "2026-09-12T08:30:00.000Z" } },
      "Discord Role": { select: role ? { name: role } : null },
      "Discord Credential Hash": { rich_text: [{ plain_text: "private-discord-hash" }] },
      "Discord Tier Proof": { rich_text: [{ plain_text: "private-discord-proof" }] },
    },
  }),
);

// Optional browser-review artifacts use the real page components and stylesheet,
// with synthetic member data. No preview route or live credential is needed.
function savePreview(name: string, html: string) {
  const directory = process.env.DISCORD_VISUAL_OUTPUT;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "globals.css"), readFileSync("app/globals.css"));
  writeFileSync(path.join(directory, name), `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="globals.css"><title>Discord 後台驗收</title></head><body>${html}</body></html>`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listMembers).mockResolvedValue(members);
  vi.mocked(getMemberByPageId).mockResolvedValue(members[2]);
});

describe("Discord records on admin pages", () => {
  it.each(["compact", "full"])("renders the Discord block in the %s member list", async (density) => {
    const html = renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({ density }) }));
    expect(requireAdmin).toHaveBeenCalled();
    expect(listMembers).toHaveBeenCalledWith({ limit: 500 });
    for (const role of ["探索者", "宇航員", "飛行員"]) expect(html).toContain(`身分組：${role}`);
    expect(html).toContain("無驗證紀錄");
    expect(html).toContain("驗證資料不完整");
    expect(html).toContain("尚無身分組紀錄");
    expect(html).toMatch(/review-block important-block[^]*?Discord/);
    expect(html).not.toMatch(/private-discord-hash|private-discord-proof/);
    savePreview(`admin-${density}.html`, html);
  });

  it("shows details and reads the role again when the page is requested again", async () => {
    const request = () => MemberDetailPage({ params: Promise.resolve({ pageId: "member-2" }) });
    const html = renderToStaticMarkup(await request());
    expect(requireAdmin).toHaveBeenCalled();
    expect(getMemberByPageId).toHaveBeenCalledWith("member-2");
    expect(html).toContain("身分組：飛行員");
    expect(html).toContain("1524807192434311390");
    expect(html).toContain("2026年9月12日 下午4:30");
    expect(html).not.toMatch(/private-discord-hash|private-discord-proof/);
    savePreview("member.html", html);

    vi.mocked(getMemberByPageId).mockResolvedValue({ ...members[2], discordRole: "宇航員" });
    const updated = renderToStaticMarkup(await request());
    expect(updated).toContain("身分組：宇航員");
    expect(updated).not.toContain("身分組：飛行員");
    expect(getMemberByPageId).toHaveBeenCalledTimes(2);
  });

  it("renders incomplete and invalid verification records in member details", async () => {
    vi.mocked(getMemberByPageId).mockResolvedValue({ ...members[5], discordVerifiedAt: "invalid-date" });
    const html = renderToStaticMarkup(await MemberDetailPage({ params: Promise.resolve({ pageId: "member-5" }) }));
    expect(html).toContain("驗證資料不完整");
    expect(html).toContain("日期格式異常");
    expect(html).toContain("尚無身分組紀錄");
    savePreview("member-incomplete.html", html);
  });
});
