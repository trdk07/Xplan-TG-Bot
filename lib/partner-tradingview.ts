import type { Member } from "@/lib/notion";
import { hasCurrentMembership } from "@/lib/membership-policy";
import { effectiveMembership, v2Enabled } from "@/lib/membership-v2";

export function activeTradingViewIds(members: Member[], now = new Date()): string[] {
  const seen = new Set<string>();
  const tradingViewIds: string[] = [];

  for (const member of members) {
    const eligible = v2Enabled()
      ? ["active_paid", "active_volume", "partner", "exempt", "VIP"].includes(
          effectiveMembership(member, now),
        )
      : hasCurrentMembership(member, now);
    if (!eligible) continue;

    const tradingViewId = member.tradingView.trim();
    if (!tradingViewId) continue;

    const key = tradingViewId.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    tradingViewIds.push(tradingViewId);
  }

  return tradingViewIds;
}
