import fs from "node:fs";
import { Client } from "@notionhq/client";
import { migrationPreview } from "../lib/membership-v2.ts";
const input = process.argv.indexOf("--input"),
  at = process.argv.indexOf("--now"),
  apply = process.argv.includes("--apply");
const now = at >= 0 ? new Date(process.argv[at + 1]) : new Date();
if (!Number.isFinite(now.getTime())) throw Error("Invalid --now");
if (apply && !process.argv.includes("--confirm-membership-v2"))
  throw Error(
    "Applying requires --confirm-membership-v2 after preview and compatible-reader rollout",
  );
let notion,
  records = [];
function member(page) {
  const p = page.properties || {},
    date = (name) => p[name]?.date?.start || null,
    text = (name) =>
      (p[name]?.rich_text || [])
        .map((t) => t.plain_text || t.text?.content || "")
        .join("");
  return {
    pageId: page.id,
    lastEditedAt: page.last_edited_time,
    status: p.Status?.select?.name || "",
    onboardingStep: p["Onboarding Step"]?.select?.name || "",
    paidAt: date("Paid At"),
    reviewDueAt: date("Review Due At"),
    groupJoinedAt: date("Group Joined At"),
    admissionVerifiedAt: date("Admission Verified At"),
    volumeCheckedAt: date("Volume Checked At"),
    volumeQualified: p["Volume Qualified"]?.checkbox === true,
    renewalStep: p["Renewal Step"]?.select?.name || "",
    kickReason: text("Kick Reason"),
  };
}
if (input >= 0) {
  if (apply) throw Error("Fixture input cannot be applied");
  records = JSON.parse(fs.readFileSync(process.argv[input + 1], "utf8"));
} else {
  const token = process.env.NOTION_API_KEY,
    source = process.env.NOTION_DATA_SOURCE_ID;
  if (!token || !source) throw Error("Missing Notion configuration");
  notion = new Client({ auth: token });
  let cursor;
  const seen = new Set();
  do {
    const response = await notion.dataSources.query({
      data_source_id: source,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    records.push(...response.results.map(member));
    if (
      response.has_more &&
      (!response.next_cursor || seen.has(response.next_cursor))
    )
      throw Error("Incomplete pagination");
    cursor = response.has_more ? response.next_cursor : null;
    if (cursor) seen.add(cursor);
  } while (cursor);
}
const result = [];
for (const original of records) {
  const preview = migrationPreview(original, now);
  const row = {
    pageId: original.pageId,
    previousStatus: original.status,
    ...preview,
  };
  if (apply && !preview.needsReview) {
    const fresh = member(
      await notion.pages.retrieve({ page_id: original.pageId }),
    );
    if (fresh.lastEditedAt !== original.lastEditedAt) {
      row.needsReview = true;
      row.reason = "Record changed since preview; skipped";
    } else {
      const properties = {
        Status: { select: { name: preview.status } },
        "Review Due At": {
          date: preview.reviewDueAt ? { start: preview.reviewDueAt } : null,
        },
        "Onboarding Step": { select: { name: preview.onboardingStep } },
        "Renewal Step": {
          select: preview.renewalStep ? { name: preview.renewalStep } : null,
        },
      };
      if (
        ["kicked", "denied"].includes(original.status) &&
        !original.kickReason
      )
        properties["Kick Reason"] = {
          rich_text: [
            {
              type: "text",
              text: {
                content: `Migrated from ${original.status}; community membership retained`,
              },
            },
          ],
        };
      await notion.pages.update({ page_id: original.pageId, properties });
      row.applied = true;
    }
  }
  result.push(row);
}
console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      records: result,
      manualReview: result.filter((r) => r.needsReview).length,
    },
    null,
    2,
  ),
);
