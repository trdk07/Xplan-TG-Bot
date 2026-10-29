// Run the actual TG dashboard HTTP client in workerd, intercepting every outbound call.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const secret = "synthetic-dashboard-worker-secret-at-least-32-chars";
const root = new URL("../../../", import.meta.url).pathname;
const bundled = await build({
  stdin: {
    contents: `import {runDiscordAdmin} from './lib/discord-admin';
export default {async fetch(_request,env){try{return Response.json(await runDiscordAdmin({action:'sync',requestId:'00000000-0000-4000-8000-000000000002',pageId:'00000000-0000-4000-8000-000000000001',discordId:'111111111111111111',verifiedAt:1790816400000,operator:'Rick'},{environment:env}));}catch(error){return Response.json({error:error.message},{status:502});}}};`,
    resolveDir: root,
    sourcefile: "admin-client-runtime.ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  tsconfig: root + "tsconfig.json",
});
let mode = "success",
  calls = 0;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    cf: false,
    modules: true,
    script: bundled.outputFiles[0].text,
    compatibilityDate: "2026-09-08",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      DISCORD_ADMIN_API_URL: "https://synthetic-dc.example",
      DISCORD_ADMIN_API_SECRET: secret,
    },
    outboundService: async (request) => {
      calls++;
      assert.equal(
        request.url,
        "https://synthetic-dc.example/internal/admin/member",
      );
      const body = await request.text(),
        stamp = request.headers.get("X-Xplan-Admin-Timestamp");
      assert.equal(
        request.headers.get("X-Xplan-Admin-Signature"),
        createHmac("sha256", secret)
          .update(`${stamp}\nPOST\n/internal/admin/member\n${body}`)
          .digest("hex"),
      );
      assert.equal(JSON.parse(body).action, "sync");
      assert.ok(!body.includes(secret));
      return mode === "redirect"
        ? new Response(null, {
            status: 302,
            headers: { Location: "https://untrusted.example" },
          })
        : Response.json({ action: "sync", message: "已同步探索者" });
    },
  }),
);
try {
  const good = await mf.dispatchFetch("https://dashboard.example");
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), {
    action: "sync",
    message: "已同步探索者",
  });
  assert.equal(calls, 1);
  mode = "redirect";
  const redirect = await mf.dispatchFetch("https://dashboard.example");
  assert.equal(redirect.status, 502);
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(await redirect.json()).includes(secret));
  console.log(
    "Dashboard client workerd smoke passed: actual signed client reaches Bot, redirects rejected without following or exposing credentials. Synthetic outbound only.",
  );
} finally {
  await mf.dispose();
}
