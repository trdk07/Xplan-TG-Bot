// Full Worker + KV-backed coordination test. Membership data lives only in the mocked Notion API.
// Uses synthetic members/credentials and cannot alter real Notion or Discord data.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("hex");
const applicationId = "222222222222222222", guildId = "333333333333333333", userId = "111111111111111111";
const trialRole = "444444444444444444", paidRole = "555555555555555555", partnerRole = "666666666666666666";
const sourceId = "34f50abc-cc15-803c-bee1-000bfc6404cb", pageId = "00000000-0000-4000-8000-000000000001";
const email = "synthetic-member@example.com", exchangeId = "0012345678";
let status = "trial_active", dueAt = "2035-01-01T00:00:00Z";
let roles = ["unrelated-free-role"];
let notionUnavailable = false;
let notionWriteUnavailable = true;
let notionDiscordId = null;
let notionWrites = 0, credentialHash = null, proof = null, verifiedAt = null;
let notionRole = null, roleWrites = 0, roleWriteUnavailable = false;
let interactionCounter = 888888888888888880n;
const replies = new Map(), outboundCalls = [];
const text = value => ({ type: "rich_text", rich_text: value ? [{ plain_text: value }] : [] });
function page() { return { object: "page", id: pageId, parent: { data_source_id: sourceId }, properties: {
  Discord_id: text(notionDiscordId), "Discord Credential Hash": text(credentialHash), "Discord Tier Proof": text(proof),
  "Discord Verified At": { type: "date", date: verifiedAt ? { start: verifiedAt } : null },
  "Discord Role": { type: "select", select: notionRole ? { name: notionRole } : null },
  "Exchange UID": { type: "rich_text", rich_text: [{ plain_text: exchangeId }] },
  Email: { type: "email", email }, Status: { type: "select", select: { name: status } },
  "Review Due At": { type: "date", date: { start: dueAt } }, "Paid At": { type: "date", date: null },
  "Payment Deadline At": { type: "date", date: null },
} }; }
const mf = new Miniflare(convertV4MiniflareOptions({
  cf: false,
  modules: true, scriptPath: new URL("../dist/index.js", import.meta.url).pathname,
  compatibilityDate: "2026-09-08", compatibilityFlags: ["nodejs_compat"],
  durableObjects: { MEMBER_GATE: { className: "NotionMemberGate", useSQLite: false } },
  bindings: {
    DISCORD_APPLICATION_ID: applicationId, DISCORD_PUBLIC_KEY: publicKey, DISCORD_GUILD_ID: guildId,
    DISCORD_TRIAL_ROLE_ID: trialRole, DISCORD_MEMBER_ROLE_ID: paidRole, DISCORD_BOT_TOKEN: "synthetic",
    DISCORD_PARTNER_ROLE_ID: partnerRole,
    NOTION_API_KEY: "synthetic", NOTION_DATA_SOURCE_ID: sourceId,
    AUTH_SECRET: "synthetic-test-only-secret-longer-than-32-chars",
  },
  outboundService: async (request) => {
    const url = new URL(request.url), method = request.method;
    outboundCalls.push({ host: url.host, path: url.pathname, method });
    if (url.host === "api.notion.com") {
      if (notionUnavailable) return new Response(null, { status: 503 });
      if (method === "GET" && url.pathname === `/v1/pages/${pageId}`) return Response.json(page());
      if (method === "POST" && url.pathname === `/v1/data_sources/${sourceId}/query`) {
        const query = await request.json();
        return Response.json({ results: query.filter.property === "Discord_id" && !notionDiscordId ? [] : [page()], has_more: false });
      }
      if (method === "PATCH" && url.pathname === `/v1/pages/${pageId}`) {
        const body = await request.json();
        assert.deepEqual(Object.keys(body), ["properties"]);
        if (Object.hasOwn(body.properties, "Discord Role")) {
          assert.deepEqual(Object.keys(body.properties), ["Discord Role"]);
          const selected = body.properties["Discord Role"].select;
          const label = selected?.name || null;
          const expectedRole = { "探索者": trialRole, "宇航員": paidRole, "飛行員": partnerRole }[label];
          assert.ok(label ? roles.includes(expectedRole) : roles.every(role => ![trialRole, paidRole, partnerRole].includes(role)), "Role result must follow successful Discord changes");
          if (roleWriteUnavailable) return new Response(null, { status: 503 });
          notionRole = label; roleWrites++;
          return Response.json(page());
        }
        assert.deepEqual(Object.keys(body.properties).sort(), ["Discord_id", "Discord Credential Hash", "Discord Tier Proof", "Discord Verified At"].sort());
        const value = name => body.properties[name].rich_text.map(t => t.text.content).join("");
        assert.equal(value("Discord_id"), userId);
        assert.match(value("Discord Credential Hash"), /^[a-f0-9]{64}$/);
        assert.ok(!JSON.stringify(body).includes(dueAt), "Shared due date must not be duplicated in Notion");
        if (notionWriteUnavailable) return new Response(null, { status: 503 });
        notionDiscordId = value("Discord_id"); credentialHash = value("Discord Credential Hash"); proof = value("Discord Tier Proof");
        // Match the live Date-property API: storage truncates below minute precision.
        verifiedAt = new Date(Math.floor(Date.parse(body.properties["Discord Verified At"].date.start) / 60_000) * 60_000).toISOString(); notionWrites++;
        return Response.json(page());
      }
    }
    if (url.host === "discord.com") {
      if (url.pathname === `/api/v10/guilds/${guildId}/members/999999999999999999` && method === "GET") return Response.json({roles:[],pending:false});
      const prefix = `/api/v10/guilds/${guildId}/members/${userId}`;
      if (url.pathname === prefix && method === "GET") return Response.json({ roles, pending: false });
      if (url.pathname.startsWith(prefix + "/roles/") && ["PUT", "DELETE"].includes(method)) {
        const role = url.pathname.split("/").at(-1); assert.ok([trialRole, paidRole, partnerRole].includes(role));
        roles = roles.filter((item) => item !== role); if (method === "PUT") roles.push(role);
        return new Response(null, { status: 204 });
      }
      const match = url.pathname.match(new RegExp(`^/api/v10/webhooks/${applicationId}/([^/]+)/messages/@original$`));
      if (match && method === "PATCH") { replies.set(match[1], await request.json()); return Response.json({ id: "synthetic-reply" }); }
    }
    throw new Error(`Unexpected outbound request: ${method} ${url.host}${url.pathname}`);
  },
}));

async function dispatch(customId, type = 5) {
  const id = String(++interactionCounter), token = `synthetic-${id}`;
  const body = JSON.stringify({ id, token, application_id: applicationId, guild_id: guildId, type,
    member: { user: { id: userId } }, data: { custom_id: customId,
      components: [{ type: 18, component: { type: 4, custom_id: "exchange_id", value: exchangeId } }, { type: 18, component: { type: 4, custom_id: "email", value: email } }],
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = Buffer.from(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body))).toString("hex");
  const response = await mf.dispatchFetch("https://example.com/interactions", { method: "POST", body,
    headers: { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": timestamp } });
  assert.equal(response.status, 200); assert.equal((await response.json()).type, 5);
  const deadline = Date.now() + 8_000;
  while (!replies.has(token) && Date.now() < deadline) await delay(20);
  assert.ok(replies.has(token), "Deferred reply must be delivered");
  return replies.get(token);
}
try {
  assert.equal((await mf.dispatchFetch("https://example.com/healthz")).status, 200);
  const failedWrite = await dispatch("xplan:credentials");
  assert.match(failedWrite.content, /暫時無法完成/);
  assert.equal(notionDiscordId, null); assert.deepEqual(roles, ["unrelated-free-role"]);
  const namespace = await mf.getDurableObjectNamespace("MEMBER_GATE");
  const object = namespace.get(namespace.idFromName(`guild:${guildId}`));
  notionWriteUnavailable = false;
  assert.equal((await object.syncBatch("")).errors, 0);
  assert.equal(notionDiscordId, userId); assert.equal(notionWrites, 1);
  assert.deepEqual(roles, ["unrelated-free-role", trialRole]);
  assert.equal(notionRole, "探索者"); assert.equal(roleWrites, 1);
  await object.syncBatch(""); assert.equal(notionWrites, 1, "Unchanged cron must not rewrite verification data");
  assert.equal(roleWrites, 1, "Unchanged role must not be rewritten");
  const verified = await dispatch("xplan:credentials"); assert.match(verified.content, /驗證完成/);
  status = "active_paid"; await object.syncBatch("");
  assert.deepEqual(roles, ["unrelated-free-role", paidRole]);
  assert.equal(notionRole, "宇航員");
  const writesBeforeReminder = notionWrites;
  status = "sent_3day_offer"; await object.syncBatch("");
  assert.deepEqual(roles, ["unrelated-free-role", paidRole]); assert.equal(notionWrites, writesBeforeReminder);
  notionDiscordId = "999999999999999999";
  assert.equal((await object.syncBatch("")).errors, 0);
  assert.deepEqual(roles, ["unrelated-free-role"]); assert.equal(notionWrites, writesBeforeReminder);
  notionDiscordId = userId; await object.syncBatch("");
  assert.deepEqual(roles, ["unrelated-free-role", paidRole]);
  notionUnavailable = true; await assert.rejects(() => object.syncBatch(""));
  assert.deepEqual(roles, ["unrelated-free-role", paidRole]);
  notionUnavailable = false; dueAt = "2020-01-01T00:00:00Z"; notionWriteUnavailable = true;
  assert.equal((await object.syncBatch("")).errors, 0);
  assert.deepEqual(roles, ["unrelated-free-role"], "Expiry revocation must not depend on Notion writes");
  notionWriteUnavailable = false; dueAt = "2035-01-01T00:00:00Z"; status = "trial_active";
  await object.syncBatch(""); assert.deepEqual(roles, ["unrelated-free-role", trialRole]);
  status = "Exempt"; dueAt = "2020-01-01T00:00:00Z"; await object.syncBatch("");
  assert.deepEqual(roles, ["unrelated-free-role", paidRole]); assert.match(proof, /^non_expiring:/);
  status = "Partner"; await object.syncBatch("");
  assert.deepEqual(roles, ["unrelated-free-role", partnerRole]); assert.match(proof, /^partner:/);
  assert.equal(notionRole, "飛行員");
  const partnerWrites = notionWrites;
  await object.syncBatch(""); assert.equal(notionWrites, partnerWrites, "Unchanged partner sync must not rewrite proof");
  const partnerReply = await dispatch("xplan:sync", 3); assert.match(partnerReply.content, /「飛行員」/);
  status = "Exempt"; roleWriteUnavailable = true;
  const roleFailure = await dispatch("xplan:credentials");
  assert.match(roleFailure.content, /Discord 身分組已完成處理，但 Notion/);
  assert.deepEqual(roles, ["unrelated-free-role", paidRole]); assert.equal(notionRole, "飛行員");
  roleWriteUnavailable = false; await object.syncBatch(""); assert.equal(notionRole, "宇航員");
  status = "Partner"; await object.syncBatch("");
  status = "denied"; notionWriteUnavailable = true; await object.syncBatch("");
  assert.deepEqual(roles, ["unrelated-free-role"], "Blocked partners lose their role even when Notion writes fail");
  assert.equal(notionRole, null);
  status = "Partner"; notionWriteUnavailable = false; await object.syncBatch("");
  assert.deepEqual(roles, ["unrelated-free-role", partnerRole]);
  notionDiscordId = null; await object.syncBatch("");
  assert.deepEqual(roles, ["unrelated-free-role"], "Clearing a Notion binding must revoke orphan roles");
  console.log("Runtime smoke passed without SQLite: signed verification → Notion write/retry → cron → paid reminder proof → changed identity blocked → outage preservation → expiry → partner/exempt role transitions → confirmed Notion role result/retry → partner revocation → orphan-role removal. Only four verification properties plus one role-result property written.");
} finally { await mf.dispose(); }
