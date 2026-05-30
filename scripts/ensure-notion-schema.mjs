import fs from "node:fs";
import { Client } from "@notionhq/client";

const env = readEnv(".env.local");
const notionApiKey = env.NOTION_API_KEY;
const dataSourceId = env.NOTION_DATA_SOURCE_ID;

if (!notionApiKey || !dataSourceId) {
  throw new Error("Missing NOTION_API_KEY or NOTION_DATA_SOURCE_ID.");
}

const notion = new Client({ auth: notionApiKey });
const dataSource = await notion.dataSources.retrieve({
  data_source_id: dataSourceId,
});
const existing = dataSource.properties || {};
const patch = {};

ensureSelect("Status", [
  { name: "eligible", color: "gray" },
  { name: "collecting_info", color: "yellow" },
  { name: "invite_sent", color: "blue" },
  { name: "join_pending", color: "orange" },
  { name: "trial_active", color: "green" },
  { name: "renewal_due", color: "yellow" },
  { name: "payment_pending", color: "purple" },
  { name: "active_paid", color: "green" },
  { name: "partner", color: "blue" },
  { name: "exempt", color: "gray" },
  { name: "VIP", color: "pink" },
  { name: "expired", color: "red" },
  { name: "kicked", color: "red" },
  { name: "denied", color: "red" },
]);
ensureMultiSelect("Tags", [{ name: "翻倉成功", color: "green" }]);
ensureRichText("Final P/L");
ensureSelect("Renewal Step", [
  { name: "awaiting_trial_result", color: "yellow" },
  { name: "awaiting_pnl", color: "orange" },
  { name: "renewal_offer_sent", color: "blue" },
  { name: "payment_pending", color: "purple" },
  { name: "completed", color: "green" },
]);
ensureRichText("Payment UID Last 4");
ensureRichText("Payment Proof File ID");
ensureDate("Payment Proof Submitted At");
ensureDate("Renewal Reminder Sent At");

if (Object.keys(patch).length) {
  await notion.dataSources.update({
    data_source_id: dataSourceId,
    properties: patch,
  });
  console.log(`Updated Notion data source properties: ${Object.keys(patch).join(", ")}`);
} else {
  console.log("Notion data source schema already includes renewal fields.");
}

function ensureRichText(name) {
  if (!existing[name]) {
    patch[name] = { rich_text: {} };
  }
}

function ensureDate(name) {
  if (!existing[name]) {
    patch[name] = { date: {} };
  }
}

function ensureSelect(name, options) {
  const current = existing[name];
  if (!current) {
    patch[name] = { select: { options } };
    return;
  }
  if (current.type !== "select") return;

  const currentOptions = current.select?.options || [];
  const missingOptions = options.filter(
    (option) => !currentOptions.some((item) => item.name === option.name),
  );
  if (missingOptions.length) {
    patch[name] = {
      select: {
        options: [
          ...currentOptions.map((option) => ({
            name: option.name,
            color: option.color,
          })),
          ...missingOptions,
        ],
      },
    };
  }
}

function ensureMultiSelect(name, options) {
  const current = existing[name];
  if (!current) {
    patch[name] = { multi_select: { options } };
    return;
  }
  if (current.type !== "multi_select") return;

  const currentOptions = current.multi_select?.options || [];
  const missingOptions = options.filter(
    (option) => !currentOptions.some((item) => item.name === option.name),
  );
  if (missingOptions.length) {
    patch[name] = {
      multi_select: {
        options: [
          ...currentOptions.map((option) => ({
            name: option.name,
            color: option.color,
          })),
          ...missingOptions,
        ],
      },
    };
  }
}

function readEnv(path) {
  const result = {};
  const raw = fs.readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
