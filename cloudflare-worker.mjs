import openNextWorker from "./.open-next/worker.js";

export default {
  fetch(request, env, ctx) {
    return openNextWorker.fetch(request, env, ctx);
  },

  scheduled(_event, env, ctx) {
    ctx.waitUntil(runDailyJob(env, ctx));
  },
};

async function runDailyJob(env, ctx) {
  const baseUrl =
    env.APP_BASE_URL || "https://tg-bot-bibibi.jason-541.workers.dev";
  const headers = new Headers();
  if (env.JOB_SECRET) {
    headers.set("authorization", `Bearer ${env.JOB_SECRET}`);
  }

  const response = await openNextWorker.fetch(
    new Request(new URL("/api/jobs/daily", baseUrl), {
      method: "POST",
      headers,
    }),
    env,
    ctx,
  );

  if (!response.ok) {
    throw new Error(`Daily membership job failed with ${response.status}`);
  }
}
