import type { Member } from "@/lib/notion";
import { hasCurrentMembership } from "@/lib/membership-policy";

export function activeTradingViewIds(members: Member[], now = new Date()): string[] {
  const seen = new Set<string>();
  const tradingViewIds: string[] = [];

  for (const member of members) {
    if (!hasCurrentMembership(member, now)) continue;

    const tradingViewId = member.tradingView.trim();
    if (!tradingViewId) continue;

    const key = tradingViewId.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    tradingViewIds.push(tradingViewId);
  }

  return tradingViewIds;
}
