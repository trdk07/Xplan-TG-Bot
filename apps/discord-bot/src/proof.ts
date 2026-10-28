import { pageKey } from "./config";
import { digest, sameDigest } from "./crypto";
import type { Binding, Member, Tier } from "./types";

export async function tierProof(secret: string, member: Pick<Member, "pageId" | "dueAt" | "paidAt">, discordId: string, credentialHash: string, tier: Tier): Promise<string> {
  return `${tier}:${await digest(secret, JSON.stringify(["discord-tier-v1", pageKey(member.pageId), discordId, credentialHash, tier, member.dueAt, member.paidAt]))}`;
}
export async function previousBinding(secret: string, member: Member): Promise<Binding | null> {
  if (!member.discordId || !member.credentialHash || !member.tierProof) return null;
  const tier = member.tierProof.split(":")[0] as Tier;
  if (!["trial", "paid", "non_expiring", "partner", "explorer", "volume"].includes(tier)
    || !sameDigest(member.tierProof, await tierProof(secret, member, member.discordId, member.credentialHash, tier))) return null;
  // Proof uses the shared dates; no duplicate date snapshots are stored in Notion.
  return { discordId: member.discordId, pageId: member.pageId, credentialHash: member.credentialHash,
    tier, dueAt: member.dueAt, paidAt: member.paidAt, verifiedAt: member.verifiedAt || 0 };
}
