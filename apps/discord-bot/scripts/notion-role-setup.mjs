import { loadEnv } from "./env.mjs";

const env = loadEnv();
const property = "Discord Role";
const options = ["探索者", "宇航員", "飛行員"].map(name => ({ name }));
const mode = process.argv[2] || "--check";
if (!["--check", "--apply"].includes(mode)) throw new Error("Use --check or --apply");
if (!env.NOTION_API_KEY || !env.NOTION_DATA_SOURCE_ID) throw new Error("Missing Notion configuration");
async function request(method = "GET", body) {
  const response = await fetch(`https://api.notion.com/v1/data_sources/${env.NOTION_DATA_SOURCE_ID}`, {
    method, headers: { Authorization: `Bearer ${env.NOTION_API_KEY}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Notion schema request failed: ${response.status}`);
  return response.json();
}
const before = await request();
const existing = before.properties?.[property];
if (existing && existing.type !== "select") throw new Error(`${property} already exists with an incompatible type; no changes made`);
if (existing) {
  console.log(`${property} already exists as select; reused without adding a duplicate column.`);
} else if (mode === "--check") {
  console.log(`Missing ${property} (select). Run --apply to add only this result column.`);
} else {
  await request("PATCH", { properties: { [property]: { select: { options } } } });
  const after = await request();
  if (after.properties?.[property]?.type !== "select") throw new Error("New role property could not be confirmed");
  for (const [name, value] of Object.entries(before.properties)) {
    if (after.properties[name]?.id !== value.id || after.properties[name]?.type !== value.type) throw new Error("Existing schema changed unexpectedly");
  }
  console.log(`${property} created and read back. All existing property IDs and types preserved.`);
}
