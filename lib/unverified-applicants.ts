import type { Member } from "@/lib/notion";

/** Applications older than this that never reached the bot are surfaced to the assistant. */
export const UNVERIFIED_AFTER_DAYS = 7;

export type UnverifiedApplicant = { member: Member; days: number };

/**
 * People who filled the application form but never pressed /start in the bot:
 * the bot stores the Telegram user ID on first contact, so its absence means
 * no contact. Nothing is deleted; they may still come back.
 */
export function unverifiedApplicants(
  members: Member[],
  now: Date,
  afterDays = UNVERIFIED_AFTER_DAYS,
): UnverifiedApplicant[] {
  return members
    .flatMap((member) => {
      const created = member.createdAt ? Date.parse(member.createdAt) : NaN;
      if (
        !Number.isFinite(created) ||
        member.telegramUserId.trim() ||
        member.groupJoinedAt ||
        ["suspended", "kicked", "denied", "partner", "exempt", "VIP"].includes(
          member.status,
        )
      )
        return [];
      const days = Math.floor((now.getTime() - created) / 86_400_000);
      return days >= afterDays ? [{ member, days }] : [];
    })
    .sort((a, b) => b.days - a.days);
}
