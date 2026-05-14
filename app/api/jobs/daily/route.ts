import { getRuntimeConfig } from "@/lib/config";
import { runDailyMembershipJob } from "@/lib/bot";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = getRuntimeConfig();
  if (config.jobSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${config.jobSecret}`) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const results = await runDailyMembershipJob();
  return Response.json({ ok: true, results });
}
