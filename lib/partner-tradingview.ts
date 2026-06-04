import type { Member } from "@/lib/notion";
import { activeGroupStatuses } from "@/lib/status";

export function activeTradingViewIds(members: Member[]): string[] {
  const seen = new Set<string>();
  const tradingViewIds: string[] = [];

  for (const member of members) {
    if (!activeGroupStatuses.has(member.status)) continue;

    const tradingViewId = member.tradingView.trim();
    if (!tradingViewId) continue;

    const key = tradingViewId.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    tradingViewIds.push(tradingViewId);
  }

  return tradingViewIds;
}
