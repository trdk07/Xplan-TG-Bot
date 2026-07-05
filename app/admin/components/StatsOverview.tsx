import Link from "next/link";
import { CircleDollarSign, Users } from "lucide-react";
import { statCount } from "@/lib/admin-views";
import type { Member } from "@/lib/notion";

type Props = {
  members: Member[];
  paymentProofReady: number;
  renewalWaiting: number;
  endingSoon: number;
  invitationEmailCount: number;
  totalRevenue: number;
  paidMembersCount: number;
};

export function StatsOverview({
  members,
  paymentProofReady,
  renewalWaiting,
  endingSoon,
  invitationEmailCount,
  totalRevenue,
  paidMembersCount,
}: Props) {
  return (
    <>
      <div className="stats-group">
        <h3 className="stats-group-label">【現況】</h3>
        <section className="grid stats">
          <Link className="stat stat-link" href="/admin">
            <span className="subtle">總人數</span>
            <strong>{members.length}</strong>
          </Link>
          <Link className="stat stat-link" href="/admin?status=active_paid">
            <span className="subtle">訂閱中</span>
            <strong>{statCount(members, ["active_paid"])}</strong>
          </Link>
          <Link className="stat stat-link" href="/admin?view=trial_experience">
            <span className="subtle">體驗中</span>
            <strong>{statCount(members, ["trial_active", "sent_7day_survey", "sent_3day_offer"])}</strong>
          </Link>
          <Link className="stat stat-link" href="/admin?status=payment_pending">
            <span className="subtle">待付款</span>
            <strong>{statCount(members, ["payment_pending"])}</strong>
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
            className={`stat stat-link${renewalWaiting > 0 ? " stat-emphasis" : ""}`}
            href="/admin?status=renewal_due"
          >
            <span className="subtle">到期未回</span>
            <strong>{renewalWaiting}</strong>
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
