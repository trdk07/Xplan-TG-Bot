import { expect, it } from "vitest";
import { proofContentType } from "@/lib/payment-proof";
import { qualificationCodeLabel } from "@/lib/qualification-labels";

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
