import Link from "next/link";
import { effectiveMembership, v2Enabled } from "@/lib/membership-v2";
import { CircleDollarSign, Users } from "lucide-react";
import { matchesAdminView } from "@/lib/admin-views";
import type { Member } from "@/lib/notion";

type Props = {
  members: Member[];
  paymentProofReady: number;
  expiredMemberships: number;
  endingSoon: number;
  invitationEmailCount: number;
  totalRevenue: number;
  paidMembersCount: number;
};

export function StatsOverview({
  members,
  paymentProofReady,
  expiredMemberships,
  endingSoon,
  invitationEmailCount,
  totalRevenue,
  paidMembersCount,
}: Props) {
  const now = new Date();
  const viewCount = (view: "paid_active" | "trial_experience" | "payment_pending") =>
    members.filter((member) => matchesAdminView(member, view, now)).length;
  return (
    <>
      <div className="stats-group">
        <h3 className="stats-group-label">【現況】</h3>
        <section className="grid stats">
          <Link className="stat stat-link" href="/admin">
            <span className="subtle">總人數</span>
            <strong>{members.length}</strong>
          </Link>
          <Link className="stat stat-link" href="/admin?view=paid_active">
            <span className="subtle">訂閱中</span>
            <strong>{viewCount("paid_active")}</strong>
          </Link>
          {v2Enabled() ? <Link className="stat stat-link" href="/admin?status=active_volume"><span className="subtle">交易量會員</span><strong>{members.filter(member => effectiveMembership(member,now) === "active_volume").length}</strong></Link> : <Link className="stat stat-link" href="/admin?view=trial_experience">
            <span className="subtle">體驗中</span>
            <strong>{viewCount("trial_experience")}</strong>
          </Link>}
          <Link className="stat stat-link" href="/admin?view=payment_pending">
            <span className="subtle">待付款</span>
            <strong>{viewCount("payment_pending")}</strong>
          </Link>
        </section>
      </div>

      <div className="stats-group">
        <h3 className="stats-group-label">【狀況監控】</h3>
        <section className="grid stats">
          <Link
            className={`stat stat-link${paymentProofReady > 0 ? " stat-emphasis" : ""}`}
            href="/admin?view=payment_review_ready"
          >
            <span className="subtle">審核付款</span>
            <strong>{paymentProofReady}</strong>
          </Link>
          <Link
            className={`stat stat-link${expiredMemberships > 0 ? " stat-emphasis" : ""}`}
            href="/admin?view=membership_expired"
          >
            <span className="subtle">會籍已到期</span>
            <strong>{expiredMemberships}</strong>
          </Link>
          <Link className="stat stat-link" href="/admin?view=ending_soon">
            <span className="subtle">即將到期</span>
            <strong>{endingSoon}</strong>
          </Link>
        </section>
      </div>

      <div className="stats-group">
        <h3 className="stats-group-label">【行政】</h3>
        <section className="grid stats">
          <Link
            className={`stat stat-link${invitationEmailCount > 0 ? " stat-emphasis" : ""}`}
            href="/admin?view=invitation_pending"
          >
            <span className="subtle">待寄邀件</span>
            <strong>{invitationEmailCount}</strong>
          </Link>
        </section>
      </div>

      <div className="stats-group">
        <h3 className="stats-group-label">【財務】</h3>
        <section className="grid stats">
          <div className="stat">
            <CircleDollarSign width={20} height={20} aria-hidden="true" />
            <span className="subtle">累計收款</span>
            <strong>{totalRevenue} U</strong>
          </div>
          <div className="stat">
            <Users width={20} height={20} aria-hidden="true" />
            <span className="subtle">付費人數</span>
            <strong>{paidMembersCount} 位</strong>
          </div>
        </section>
      </div>
    </>
  );
}
