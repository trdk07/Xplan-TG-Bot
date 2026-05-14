import { badgeTone, memberStatusLabel, type MemberStatus } from "@/lib/status";

export function StatusBadge({ status }: { status: MemberStatus }) {
  return <span className={`badge ${badgeTone(status)}`}>{memberStatusLabel(status)}</span>;
}
