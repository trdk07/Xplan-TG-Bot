import { getRuntimeConfig } from "@/lib/config";
import { listMembers } from "@/lib/notion";
import { activeTradingViewIds } from "@/lib/partner-tradingview";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = getRuntimeConfig();

  if (!config.partnerApiToken) {
    return Response.json(
      { ok: false, error: "Partner API token is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${config.partnerApiToken}`) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const tradingViewIds = activeTradingViewIds(await listMembers());

  return Response.json(
    {
      ok: true,
      count: tradingViewIds.length,
      tradingViewIds,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
