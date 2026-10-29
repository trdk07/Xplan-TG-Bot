import fs from "node:fs";
import { Client } from "@notionhq/client";

const fields = {
  "Onboarding Step": "select",
  "Admission Verified At": "date",
  "Verified Deposit USDT": "number",
  "Deposit Evidence Complete": "checkbox",
  "Deposit Review Reason": "rich_text",
  "Deposit Reviewed At": "date",
  "Deposit Reviewed By": "rich_text",
  "Volume Spot 30D": "number",
  "Volume Futures 30D": "number",
  "Volume Total 30D": "number",
  "Volume Qualified": "checkbox",
  "Volume Window Start": "date",
  "Volume Window End": "date",
  "Volume Checked At": "date",
  "Volume Check Error": "rich_text",
  "Qualification Checked At": "date",
};
export function additiveSchema(existing) {
  const patch = {};
  function select(name, values) {
    const current = existing[name];
    if (current && current.type !== "select")
      throw Error(`${name} must be select`);
    const options = current?.select?.options || [];
    patch[name] = {
      select: {
        options: [
          ...options.map(({ name, color }) => ({ name, color })),
          ...values
            .filter((name) => !options.some((o) => o.name === name))
            .map((name) => ({ name, color: "default" })),
        ],
      },
    };
  }
  select("Status", [
    "free",
    "active_volume",
    "active_paid",
    "partner",
    "exempt",
    "VIP",
    "suspended",
  ]);
  select("Exchange Name", ["MEXC", "Bitget", "OKX"]);
  for (const [name, type] of Object.entries(fields)) {
    if (existing[name] && existing[name].type !== type)
      throw Error(`${name} must be ${type}`);
    if (type === "select")
      select(name, [
        "collecting_info",
        "eligible",
        "join_pending",
        "joined",
        "needs_review",
      ]);
    else if (!existing[name]) patch[name] = { [type]: {} };
  }
  return patch;
}
const input = process.argv.indexOf("--input"),
  apply = process.argv.includes("--apply");
if (input >= 0) {
  if (apply) throw Error("Fixture input cannot be applied");
  const fixture = JSON.parse(fs.readFileSync(process.argv[input + 1], "utf8"));
  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        properties: additiveSchema(fixture.properties || fixture),
      },
      null,
      2,
    ),
  );
} else {
  const token = process.env.NOTION_API_KEY,
    source = process.env.NOTION_DATA_SOURCE_ID;
  if (!token || !source)
    throw Error(
      "Missing NOTION_API_KEY or NOTION_DATA_SOURCE_ID; preview with --input for offline checks",
    );
  const notion = new Client({ auth: token });
  const data = await notion.dataSources.retrieve({ data_source_id: source });
  const properties = additiveSchema(data.properties || {});
  if (apply) {
    await notion.dataSources.update({ data_source_id: source, properties });
    console.log("Additive membership schema applied; no options deleted.");
  } else console.log(JSON.stringify({ mode: "dry-run", properties }, null, 2));
}
