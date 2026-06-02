import fs from "node:fs";
import { Client } from "@notionhq/client";

const env = { ...process.env, ...readEnv(".env.local") };
const notionApiKey = env.NOTION_API_KEY;
const dataSourceId = env.NOTION_DATA_SOURCE_ID;
const explicitDatabaseId = env.NOTION_DATABASE_ID;
const shouldApply = process.argv.includes("--apply");

if (!notionApiKey || !dataSourceId) {
  throw new Error("Missing NOTION_API_KEY or NOTION_DATA_SOURCE_ID.");
}

const notion = new Client({ auth: notionApiKey });
const dataSource = await notion.dataSources.retrieve({
  data_source_id: dataSourceId,
});
const databaseId =
  explicitDatabaseId || dataSource.parent?.database_id || dataSource.database_id;

if (!databaseId) {
  throw new Error("Unable to resolve parent Notion database id.");
}

const properties = dataSource.properties || {};
const propertyIds = Object.fromEntries(
  Object.entries(properties).map(([name, property]) => [name, property.id]),
);
const existingViews = await listViews(databaseId);
const fullViews = await Promise.all(
  existingViews.map((view) => notion.views.retrieve({ view_id: view.id })),
);
const expectedViews = buildExpectedViews();
const actions = [];

for (const expected of expectedViews) {
  const current = findExistingView(expected.name);
  if (!current) {
    actions.push({ type: "create", expected });
    continue;
  }

  actions.push({
    type: "update",
    viewId: current.id,
    currentName: current.name,
    expected,
  });
}

const primarySourceView = fullViews.find(
  (view) =>
    view.name === "Untitled" ||
    view.name === "主表 / 全部資料" ||
    view.name === "Tally 原始主表 / 全部資料",
);
if (primarySourceView) {
  actions.unshift({
    type: "update",
    viewId: primarySourceView.id,
    currentName: primarySourceView.name,
    expected: {
      name: "Tally 原始主表 / 全部資料",
      filter: null,
      sorts: null,
      configuration: tableConfig(Object.keys(properties)),
    },
  });
}

if (!shouldApply) {
  console.log("[dry-run] Notion views were not changed.");
}

for (const action of actions) {
  const prefix = shouldApply ? "[apply]" : "[dry-run]";
  if (action.type === "create") {
    console.log(`${prefix} create view: ${action.expected.name}`);
    if (shouldApply) {
      await notion.views.create({
        data_source_id: dataSourceId,
        database_id: databaseId,
        type: "table",
        ...createViewPayload(action.expected),
      });
    }
    continue;
  }

  console.log(
    `${prefix} update view: ${action.currentName} -> ${action.expected.name}`,
  );
  if (shouldApply) {
    await notion.views.update({
      view_id: action.viewId,
      ...action.expected,
    });
  }
}

console.log(
  `${shouldApply ? "Applied" : "Planned"} ${actions.length} Notion view actions.`,
);

function buildExpectedViews() {
  return [
    {
      name: "現有會員",
      filter: statusIn(["trial_active", "active_paid", "partner", "exempt", "VIP"]),
      sorts: sortBy("Review Due At", "ascending"),
      configuration: tableConfig([
        "Telegram Username",
        "Status",
        "Review Due At",
        "Paid At",
        "Exchange Name",
        "Exchange UID",
        "TradingView",
        "Telegram User ID",
        "Last Bot Message",
      ]),
    },
    {
      name: "體驗會員",
      filter: statusEquals("trial_active"),
      sorts: sortBy("Review Due At", "ascending"),
      configuration: tableConfig([
        "Telegram Username",
        "Review Due At",
        "Renewal Reminder Sent At",
        "Exchange UID",
        "TradingView",
        "Group Joined At",
        "Last Bot Message",
      ]),
    },
    {
      name: "待付款 / 待補件",
      filter: {
        and: [
          statusEquals("payment_pending"),
          {
            or: [
              richTextIsEmpty("Payment Proof File ID"),
              richTextIsEmpty("Payment UID Last 4"),
            ],
          },
        ],
      },
      sorts: sortBy("Payment Deadline At", "ascending"),
      configuration: tableConfig([
        "Telegram Username",
        "Payment Deadline At",
        "Payment UID Last 4",
        "Payment Proof File ID",
        "Last Bot Message",
        "Exchange Name",
        "Exchange UID",
      ]),
    },
    {
      name: "待審核付款",
      filter: {
        and: [
          statusEquals("payment_pending"),
          richTextIsNotEmpty("Payment Proof File ID"),
          richTextIsNotEmpty("Payment UID Last 4"),
        ],
      },
      sorts: sortBy("Payment Proof Submitted At", "ascending"),
      configuration: tableConfig([
        "Telegram Username",
        "Payment UID Last 4",
        "Payment Proof File ID",
        "Payment Proof Submitted At",
        "Exchange Name",
        "Exchange UID",
        "Paid At",
        "Last Bot Message",
      ]),
    },
    {
      name: "已付款會員",
      filter: statusEquals("active_paid"),
      sorts: sortBy("Review Due At", "ascending"),
      configuration: tableConfig([
        "Telegram Username",
        "Paid At",
        "Review Due At",
        "Exchange Name",
        "Exchange UID",
        "TradingView",
      ]),
    },
    {
      name: "待撤銷 TradingView",
      filter: {
        property: propId("TradingView Access"),
        select: { equals: "待撤銷" },
      },
      sorts: sortBy("Review Due At", "ascending"),
      configuration: tableConfig([
        "Telegram Username",
        "Status",
        "TradingView",
        "TradingView Access",
        "Kick Reason",
        "Review Due At",
      ]),
    },
    {
      name: "歷史會員",
      filter: statusIn(["expired", "kicked", "denied"]),
      sorts: sortBy("Review Due At", "descending"),
      configuration: tableConfig([
        "Telegram Username",
        "Status",
        "Kick Reason",
        "TradingView",
        "TradingView Access",
        "Review Due At",
        "Last Bot Message",
      ]),
    },
    {
      name: "報名資料",
      filter: null,
      sorts: sortBy("Submitted at", "descending"),
      configuration: tableConfig([
        "Telegram Username",
        "Email",
        "群組暱稱",
        "入金的本金",
        "想要翻倉金額（給自己一個目標）",
        "是否理解概念",
        "從哪裡知道的",
        "Submitted at",
        "Respondent ID",
      ]),
    },
  ];
}

function createViewPayload(expected) {
  const payload = { ...expected };
  if (payload.filter === null) delete payload.filter;
  if (payload.sorts === null) delete payload.sorts;
  return payload;
}

async function listViews(databaseId) {
  const views = [];
  let cursor;
  do {
    const response = await notion.views.list({
      database_id: databaseId,
      page_size: 100,
      start_cursor: cursor,
    });
    views.push(...response.results);
    cursor = response.next_cursor;
  } while (cursor);
  return views;
}

function findExistingView(name) {
  return fullViews.find((view) => view.name === name);
}

function tableConfig(visibleNames) {
  const visible = new Set(visibleNames);
  return {
    type: "table",
    properties: Object.keys(properties).map((name) => ({
      property_id: propId(name),
      property_name: name,
      visible: visible.has(name),
      width: visible.has(name) ? widthFor(name) : undefined,
    })),
    wrap_cells: true,
    frozen_column_index: 1,
  };
}

function widthFor(name) {
  if (name === "Telegram Username") return 220;
  if (name === "Last Bot Message") return 320;
  if (name.includes("Proof File ID")) return 280;
  if (name.includes("Deadline") || name.includes("Due") || name.includes(" At")) {
    return 180;
  }
  return 180;
}

function statusEquals(status) {
  return {
    property: propId("Status"),
    select: { equals: status },
  };
}

function statusIn(statuses) {
  return {
    or: statuses.map((status) => statusEquals(status)),
  };
}

function richTextIsEmpty(name) {
  return {
    property: propId(name),
    rich_text: { is_empty: true },
  };
}

function richTextIsNotEmpty(name) {
  return {
    property: propId(name),
    rich_text: { is_not_empty: true },
  };
}

function sortBy(name, direction) {
  return [
    {
      property: propId(name),
      direction,
    },
  ];
}

function propId(name) {
  const id = propertyIds[name];
  if (!id) {
    throw new Error(`Missing Notion property: ${name}`);
  }
  return id;
}

function readEnv(path) {
  const result = {};
  if (!fs.existsSync(path)) return result;
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
