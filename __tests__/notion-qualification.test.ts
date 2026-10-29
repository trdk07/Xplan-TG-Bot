import { it, expect } from "vitest";
import { mapNotionPageToMember, buildNotionProperties } from "@/lib/notion";
it("reads and writes independent evidence while retaining Discord ownership", () => {
  const page = {
    id: "member",
    properties: {
      Status: { select: { name: "free" } },
      "Admission Verified At": { type: "date", date: { start: "2026-01-01" } },
      "Volume Qualified": { type: "checkbox", checkbox: true },
      "Volume Spot 30D": { type: "number", number: 200000 },
    },
  };
  const member = mapNotionPageToMember(page);
  expect(member.status).toBe("free");
  expect(member.admissionVerifiedAt).toBe("2026-01-01");
  expect(member.volumeQualified).toBe(true);
  const properties = buildNotionProperties({
    volumeQualified: false,
    volumeSpot30d: 0,
    admissionVerifiedAt: null,
    depositReviewReason: "人工覆核",
  });
  expect(properties).toMatchObject({
    "Volume Qualified": { checkbox: false },
    "Volume Spot 30D": { number: 0 },
    "Admission Verified At": { date: null },
    "Deposit Review Reason": { rich_text: [{ text: { content: "人工覆核" } }] },
  });
  expect(properties).not.toHaveProperty("Discord Role");
});
