// Real workerd/DO execution; all Notion and Discord requests are synthetic and intercepted.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("hex");
const applicationId = "222222222222222222", guildId = "333333333333333333", userId = "111111111111111111";
const explorer = "444444444444444444", astronaut = "555555555555555555", pilot = "666666666666666666";
const sourceId = "00000000-0000-4000-8000-000000000000", pageId = "00000000-0000-4000-8000-000000000001";
const email = "synthetic@example.com", uid = "0012345678901234567890";
let status = "active_paid", due = "2035-01-01", paid = "2026-01-01", qualified = true;
let discordId = null, hash = null, proof = null, verified = null, role = null;
let roleWriteFails = false, metadataWriteFails = false, notionUnavailable = false;
let bindingsWritten = 0;
const guild = new Map([
  [userId, { roles: ["foreign"], pending: false, bot: false }],
  ["111111111111111112", { roles: ["foreign"], pending: false, bot: false }],
  ["111111111111111113", { roles: [], pending: true, bot: false }],
  ["111111111111111114", { roles: [], pending: false, bot: true }],
  ["111111111111111115", { roles: [astronaut, "foreign"], pending: false, bot: false }],
]);
const text = value => ({ type: "rich_text", rich_text: value ? [{ plain_text: value }] : [] });
const date = start => ({ type: "date", date: start ? { start } : null });
const page = () => ({ object: "page", id: pageId, parent: { data_source_id: sourceId }, properties: {
  Email: { type: "email", email }, "Exchange Name": { type: "select", select: { name: "OKX" } }, "Exchange UID": text(uid),
  Status: { type: "select", select: { name: status } }, "Paid At": date(paid), "Review Due At": date(due), "Payment Deadline At": date(null),
  "Admission Verified At": date("2026-01-01"), "Volume Qualified": { type: "checkbox", checkbox: qualified },
  "Volume Checked At": date("2026-01-02"), "Volume Check Error": text("synthetic stale upstream"),
  Discord_id: text(discordId), "Discord Credential Hash": text(hash), "Discord Tier Proof": text(proof), "Discord Verified At": date(verified),
  "Discord Role": { type: "select", select: role ? { name: role } : null },
} });
const replies = new Map(); let interaction = 888888888888888880n;
const mf = new Miniflare(convertV4MiniflareOptions({ cf: false, modules: true,
  scriptPath: new URL("../dist/index.js", import.meta.url).pathname,
  compatibilityDate: "2026-09-08", compatibilityFlags: ["nodejs_compat"],
  durableObjects: { MEMBER_GATE: { className: "NotionMemberGate", useSQLite: false } },
  bindings: { DISCORD_APPLICATION_ID: applicationId, DISCORD_PUBLIC_KEY: publicKey, DISCORD_GUILD_ID: guildId,
    DISCORD_EXPLORER_ROLE_ID: explorer, DISCORD_MEMBER_ROLE_ID: astronaut, DISCORD_PARTNER_ROLE_ID: pilot, DISCORD_BOT_TOKEN: "synthetic",
    NOTION_API_KEY: "synthetic", NOTION_DATA_SOURCE_ID: sourceId, AUTH_SECRET: "synthetic-test-only-secret-longer-than-32-chars", MEMBERSHIP_POLICY_V2_ENABLED: "true" },
  outboundService: async request => {
    const url = new URL(request.url), method = request.method;
    if (url.host === "api.notion.com") {
      if (notionUnavailable) return new Response(null, { status: 503 });
      if (method === "GET" && url.pathname === `/v1/pages/${pageId}`) return Response.json(page());
      if (method === "POST" && url.pathname === `/v1/data_sources/${sourceId}/query`) {
        const query = await request.json();
        return Response.json({ results: query.filter.property === "Discord_id" && !discordId ? [] : [page()], has_more: false });
      }
      if (method === "PATCH" && url.pathname === `/v1/pages/${pageId}`) {
        const { properties } = await request.json();
        if (Object.hasOwn(properties, "Discord Role")) {
          assert.deepEqual(Object.keys(properties), ["Discord Role"]);
          const label = properties["Discord Role"].select?.name || null;
          const expected = { "探索者": explorer, "宇航員": astronaut, "飛行員": pilot }[label];
          assert.ok(guild.get(userId).roles.includes(expected), "Notion result must follow Discord success");
          if (roleWriteFails) return new Response(null, { status: 503 });
          role = label;
        } else {
          assert.deepEqual(Object.keys(properties).sort(), ["Discord_id", "Discord Credential Hash", "Discord Tier Proof", "Discord Verified At"].sort());
          if (metadataWriteFails) return new Response(null, { status: 503 });
          const value = name => properties[name].rich_text.map(t => t.text.content).join("");
          discordId = value("Discord_id"); hash = value("Discord Credential Hash"); proof = value("Discord Tier Proof");
          verified = new Date(Math.floor(Date.parse(properties["Discord Verified At"].date.start) / 60000) * 60000).toISOString(); bindingsWritten++;
        }
        return Response.json(page());
      }
    }
    if (url.host === "discord.com") {
      if (url.pathname === `/api/v10/guilds/${guildId}/members` && method === "GET") {
        return Response.json([...guild].map(([id, m]) => ({ user: { id, bot: m.bot }, roles: m.roles, pending: m.pending })));
      }
      const match = url.pathname.match(new RegExp(`^/api/v10/guilds/${guildId}/members/([0-9]+)(?:/roles/([0-9]+))?$`));
      if (match) {
        const m = guild.get(match[1]); assert.ok(m);
        if (method === "GET") return Response.json({ user: { id: match[1], bot: m.bot }, roles: m.roles, pending: m.pending });
        assert.ok(["PUT", "DELETE"].includes(method) && [explorer, astronaut, pilot].includes(match[2]));
        assert.ok(!m.pending && !m.bot);
        assert.ok(match[1] === userId || (method === "PUT" && match[2] === explorer), "Unbound roles must never be removed");
        m.roles = m.roles.filter(r => r !== match[2]); if (method === "PUT") m.roles.push(match[2]);
        return new Response(null, { status: 204 });
      }
      const reply = url.pathname.match(new RegExp(`^/api/v10/webhooks/${applicationId}/([^/]+)/messages/@original$`));
      if (reply && method === "PATCH") { replies.set(reply[1], await request.json()); return Response.json({ id: "synthetic" }); }
    }
    throw new Error(`Unexpected synthetic request ${method} ${url.host}${url.pathname}`);
  },
}));
async function dispatch(customId, type = 5) {
  const id = String(++interaction), token = `synthetic-${id}`;
  const body = JSON.stringify({ id, token, application_id: applicationId, guild_id: guildId, type,
    member: { user: { id: userId } }, data: { custom_id: customId, components: [
      { type: 18, component: { type: 3, custom_id: "exchange", values: ["okx"] } },
      { type: 18, component: { type: 4, custom_id: "exchange_id", value: uid } },
      { type: 18, component: { type: 4, custom_id: "email", value: email } },
    ] } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = Buffer.from(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body))).toString("hex");
  const response = await mf.dispatchFetch("https://synthetic.test/interactions", { method: "POST", body, headers: { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": timestamp } });
  assert.equal(response.status, 200); const data = await response.json();
  if (data.type === 9) return data;
  assert.equal(data.type, 5);
  for (const deadline = Date.now() + 12_000; !replies.has(token) && Date.now() < deadline;) await delay(20);
  assert.ok(replies.has(token)); return replies.get(token);
}
try {
  const modal = await dispatch("xplan:verify", 3);
  assert.match(JSON.stringify(modal), /"value":"okx"/);
  assert.match((await dispatch("xplan:credentials")).content, /「宇航員」/);
  assert.equal(discordId, userId); assert.match(proof, /^paid:/);
  const namespace = await mf.getDurableObjectNamespace("MEMBER_GATE");
  const object = namespace.get(namespace.idFromName(`guild:${guildId}`));
  const check = async expected => { assert.equal((await object.syncBatch("")).errors, 0); assert.deepEqual(guild.get(userId).roles, ["foreign", expected]); };
  due = "2020-01-01"; await check(astronaut); assert.match(proof, /^volume:/);
  qualified = false; metadataWriteFails = true; await check(explorer); assert.equal(role, "探索者");
  metadataWriteFails = false; qualified = true; status = "suspended"; await check(explorer);
  status = "partner"; await check(pilot);
  status = "VIP"; roleWriteFails = true;
  assert.equal((await object.syncBatch("")).errors, 1); assert.deepEqual(guild.get(userId).roles, ["foreign", astronaut]); assert.equal(role, "飛行員");
  roleWriteFails = false; await check(astronaut); assert.equal(role, "宇航員");
  notionUnavailable = true; await assert.rejects(() => object.syncBatch("")); assert.deepEqual(guild.get(userId).roles, ["foreign", astronaut]); notionUnavailable = false;
  const before = bindingsWritten; await check(astronaut); assert.equal(bindingsWritten, before);
  const defaults = await object.defaultExplorerBatch(""); assert.equal(defaults.assigned, 1); assert.equal(defaults.review, 1);
  assert.deepEqual(guild.get("111111111111111112").roles, ["foreign", explorer]);
  assert.deepEqual(guild.get("111111111111111113").roles, []); assert.deepEqual(guild.get("111111111111111114").roles, []);
  assert.deepEqual(guild.get("111111111111111115").roles, [astronaut, "foreign"]);
  assert.equal((await object.defaultExplorerBatch("")).assigned, 0);
  discordId = null; await object.syncBatch(""); assert.deepEqual(guild.get(userId).roles, ["foreign", astronaut]);
  console.log("V2 runtime smoke passed: signed exchange/UID/Email → paid → expired paid with stale qualified volume → Explorer despite metadata outage → suspended priority → partner/VIP → role writeback retry → Notion outage preservation → idempotence → default Explorer/bot/screening/unbound premium safeguards. Synthetic APIs only; KV-backed DO preserved.");
} finally { await mf.dispose(); }
