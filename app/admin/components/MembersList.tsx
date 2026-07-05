import Link from "next/link";
import { Ban, Filter, Upload } from "lucide-react";
import {
  kickMemberAction,
  requestPaymentProofAction,
} from "@/app/admin/actions";
import {
  ExchangeSummary,
  DateStack,
  PaymentReviewSummary,
  RenewalReviewSummary,
  TradingViewSummary,
} from "@/app/admin/components/MemberSummaries";
import { ActionButton } from "@/app/components/ActionButton";
import { StatusBadge } from "@/app/components/StatusBadge";
import type { Member } from "@/lib/notion";

type Props = {
  members: Member[];
  displayMembers: Member[];
  hiddenCount: number;
  inactive: string;
  q: string;
  status: string;
};

export function MembersList({
  members,
  displayMembers,
  hiddenCount,
  inactive,
  q,
  status,
}: Props) {
  return (
    <div className="members-list">
      {hiddenCount > 0 ? (
        <div style={{ marginBottom: 8 }}>
          <Link
            className="button secondary"
            href={`/admin?q=${encodeURIComponent(q)}&status=${status}&inactive=show`}
          >
            顯示 {hiddenCount} 位歷史會員
          </Link>
        </div>
      ) : inactive === "show" && members.length > displayMembers.length + hiddenCount ? null : inactive === "show" ? (
        <div style={{ marginBottom: 8 }}>
          <Link
            className="button secondary"
            href={`/admin?q=${encodeURIComponent(q)}&status=${status}`}
          >
            隱藏歷史會員
          </Link>
        </div>
      ) : null}
      {inactive === "show" && hiddenCount === 0 ? (
        <div style={{ marginBottom: 8 }}>
          <Link
            className="button secondary"
            href={`/admin?q=${encodeURIComponent(q)}&status=${status}`}
          >
            隱藏歷史會員
          </Link>
        </div>
      ) : null}
      {displayMembers.map((member) => (
        <article className="member-card" key={member.pageId}>
          <div className="member-main">
            <div className="member-identity">
              <strong>{member.telegramUserId || "-"}</strong>
              <span className="subtle">{member.telegramUsername || "-"}</span>
              <span className="email-text">{member.email || "No email"}</span>
            </div>
            <div className="member-status-row">
              <StatusBadge status={member.status} />
              {member.invitationEmailSent ? (
                <span className="mini-badge success">
                  <span className="badge-dot" aria-hidden="true" />
                  邀請已送出
                </span>
              ) : (
                <span className="mini-badge muted">
                  <span className="badge-dot" aria-hidden="true" />
                  邀請未送出
                </span>
              )}
            </div>
          </div>

          <div className="member-review-grid">
            <div className="review-block important-block">
              <span className="mobile-label">續約狀態</span>
              <RenewalReviewSummary member={member} />
            </div>
            <div className="review-block important-block">
              <span className="mobile-label">付款審核</span>
              <PaymentReviewSummary member={member} />
            </div>
            <div className="review-block">
              <span className="mobile-label">交易所</span>
              <ExchangeSummary member={member} />
            </div>
            <div className="review-block compact-text">
              <span className="mobile-label">Exchange UID</span>
              <span>{member.exchangeUid || "-"}</span>
            </div>
            <div className="review-block compact-text">
              <span className="mobile-label">Tags</span>
              <span>{member.tags.length ? member.tags.join(", ") : "-"}</span>
            </div>
            <TradingViewSummary member={member} />
            <div className="member-date-grid">
              <DateStack label="Joined" value={member.groupJoinedAt} />
              <DateStack label="Review Due" value={member.reviewDueAt} />
              <DateStack label="付款期限" value={member.paymentDeadlineAt} />
              <DateStack label="最後檢查" value={member.lastBotCheckAt} />
            </div>
          </div>

          <div className="member-actions">
            <form action={requestPaymentProofAction.bind(null, member.pageId)}>
              <ActionButton icon={<Upload />} secondary disabled={!member.telegramUserId}>
                重新付款
              </ActionButton>
            </form>
            <Link
              className="button secondary"
              href={`/admin/member/${member.pageId}`}
            >
              <Filter width={16} height={16} aria-hidden="true" />
              管理
            </Link>
            <form action={kickMemberAction.bind(null, member.pageId)}>
              <ActionButton icon={<Ban />} danger disabled={!member.telegramUserId}>
                踢出
              </ActionButton>
            </form>
          </div>
        </article>
      ))}
      {!members.length ? (
        <div className="empty-state subtle">沒有符合條件的會員。</div>
      ) : null}
    </div>
  );
}
