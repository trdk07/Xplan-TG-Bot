import { expect, it } from "vitest";
import { proofContentType } from "@/lib/payment-proof";
import { qualificationCodeLabel } from "@/lib/qualification-labels";
import { discordNoteAfterApproval } from "@/lib/discord-admin";

it("serves Telegram's generic binary download as a viewable image", () => {
  expect(proofContentType("photos/file_12.jpg", "application/octet-stream")).toBe("image/jpeg");
  expect(proofContentType("documents/file_3.PNG", "application/octet-stream")).toBe("image/png");
  expect(proofContentType("documents/file_4.webp", null)).toBe("image/webp");
  expect(proofContentType("photos/file_5", null)).toBe("image/jpeg");
  expect(proofContentType("x.bin", "image/png; charset=binary")).toBe("image/png");
});
it("explains qualification codes in plain language and keeps unknown text", () => {
  expect(qualificationCodeLabel("admission_disabled")).toBe("此交易所的入群自動查核尚未開啟");
  expect(qualificationCodeLabel("缺少交易所或 UID")).toBe("缺少交易所或 UID");
  expect(qualificationCodeLabel(null)).toBe("");
});

it("tells an approved member what happened to their Discord role", () => {
  expect(discordNoteAfterApproval("", null)).toContain("尚未驗證");
  expect(
    discordNoteAfterApproval("123", "驗證完成，已同步「宇航員」身分組。"),
  ).toBe("Discord 身分組已同步更新。");
  expect(
    discordNoteAfterApproval("123", "會員資料或 Discord 綁定已變更，請重新驗證或聯絡助理確認。"),
  ).toContain("需要重新驗證");
  expect(discordNoteAfterApproval("123", null)).toContain("10 分鐘內");
});

import { describeVolumeProbe } from "@/lib/volume-probe";
import { amountRemainder, volumeMeetsThreshold } from "@/lib/membership-v2";
it("counts other turnover toward the 200,000 threshold with exact decimals", () => {
  expect(volumeMeetsThreshold("100000", "99999.99")).toBe(false);
  expect(volumeMeetsThreshold("100000", "99999.99", "0.01")).toBe(true);
  expect(amountRemainder("7500.5", ["1000", "5000"])).toBe("1500.5");
  expect(amountRemainder("6000", ["1000", "5000"])).toBe("0");
  expect(amountRemainder("5999", ["1000", "5000"])).toBeNull();
});
it("summarises a probe for the assistant without persisting anything", () => {
  const window = { start: "2026-10-11T16:00:00.000Z", end: "2026-11-10T16:00:00.000Z" };
  const state = describeVolumeProbe("bitget", "123", window, {
    spot: "50000",
    futures: "140000",
    other: "20000",
    days: [
      { time: Date.parse(window.start), spot: "50000", futures: "140000", total: "210000" },
      { time: Date.parse(window.start) + 86400000, spot: "0", futures: "0", total: "0" },
    ],
  });
  expect(state.kind).toBe("success");
  expect(state.message).toContain("近 30 天合計 210,000，已達 200,000 門檻");
  expect(state.lines).toContain("其他（鏈上／CFD／美股等）：20,000");
  expect(state.lines).toContain("有成交的天數：1 / 2");
  expect(state.lines.at(-1)).toContain("不會寫入 Notion");
});
