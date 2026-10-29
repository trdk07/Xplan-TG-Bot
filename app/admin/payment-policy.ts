import {
  currentPaidFacts,
  v2Statuses,
  type MembershipFacts,
} from "@/lib/membership-v2";

const trustedPaidStatuses = new Set<string>([
  ...v2Statuses,
  "kicked",
  "denied",
]);

// Dates on an ambiguous legacy trial/payment label cannot extend a newly
// approved payment. Known special/blocked records retain independent paid facts.
export function hasTrustedPaidPeriod(
  member: MembershipFacts,
  now = new Date(),
): boolean {
  return (
    trustedPaidStatuses.has(member.status) && currentPaidFacts(member, now)
  );
}
