import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { BadgeCheck, ImageIcon } from "lucide-react";
import {
  markPaidAction,
  requestPaymentProofAction,
  resendRenewalDueReminderAction,
} from "@/app/admin/actions";
import { ActionButton } from "@/app/components/ActionButton";
import { CopyEmailListButton } from "@/app/components/CopyEmailListButton";
import { StatusBadge } from "@/app/components/StatusBadge";
import {
  isInvitationPending,
  isPaymentIncomplete,
} from "@/lib/admin-views";
import { isPaymentReviewReady } from "@/lib/member-state";
import type { Member } from "@/lib/notion";

const INBOX_PREVIEW_LIMIT = 5;

function Avatar({ label }: { label: string }) {
  const initial = label.replace(/^@/, "").trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span className="inbox-avatar" aria-hidden="true">
      {initial}
    </span>
  );
}

function InboxMemberCard({
  member,
  detail,
  children,
}: {
  member: Member;
  detail: string;
  children: ReactNode;
}) {
  const label = member.telegramUsername || member.telegramUserId || "-";
  return (
    <article className="inbox-card">
      <Avatar label={label} />
      <div className="inbox-card-body">
        <div className="inbox-card-head">
          <strong>{label}</strong>
          <StatusBadge status={member.status} />
        </div>
        <p className="subtle small-text">{detail}</p>
      </div>
      <div className="inbox-card-actions">{children}</div>
    </article>
  );
}

function InboxGroup({
  title,
  tone,
  count,
  viewHref,
  children,
}: {
  title: string;
  tone: "danger" | "warning" | "info";
  count: number;
  viewHref: string;
  children: ReactNode;
}) {
  return (
    <div className={`inbox-group inbox-group-${tone}`}>
      <div className="inbox-group-head">
        <h3>
          {title} <span className="inbox-count">{count}</span>
        </h3>
        {count > INBOX_PREVIEW_LIMIT ? (
          <Link className="subtle small-text" href={viewHref as Route}>
            查看全部 {count} 位 →
          </Link>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function TodayInbox({ members }: { members: Member[] }) {
  const paymentReview = members.filter((member) => isPaymentReviewReady(member));
  const paymentIncomplete = members.filter((member) => isPaymentIncomplete(member));
  const renewalDue = members.filter((member) => member.status === "renewal_due");
  const invitationPending = members.filter((member) => isInvitationPending(member));

  const total =
    paymentReview.length +
    paymentIncomplete.length +
    renewalDue.length +
    invitationPending.length;

  if (!total) {
    return (
      <section className="panel inbox-panel">
        <div className="panel-head">
          <h2>今日待辦</h2>
        </div>
        <div className="panel-body">
          <p>今天沒有待辦。所有會員狀態正常。</p>
          <p className="subtle small-text">下次每日檢查：明早 09:00</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel inbox-panel">
      <div className="panel-head">
        <h2>今日待辦</h2>
        <span className="subtle">共 {total} 件</span>
      </div>
      <div className="panel-body inbox-body">
        {paymentReview.length ? (
          <InboxGroup
            title="待審核付款"
            tone="danger"
            count={paymentReview.length}
            viewHref="/admin?view=payment_review_ready"
          >
            <div className="inbox-cards">
              {paymentReview.slice(0, INBOX_PREVIEW_LIMIT).map((member) => (
                <InboxMemberCard
                  key={member.pageId}
                  member={member}
                  detail={`UID 末四碼：${member.paymentUidLast4 || "-"}`}
                >
                  {member.paymentProofFileId ? (
                    <a
                      className="button secondary small"
                      href={`/api/admin/payment-proof?fileId=${encodeURIComponent(member.paymentProofFileId)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ImageIcon width={13} height={13} aria-hidden="true" />
                      看截圖
                    </a>
                  ) : null}
                  <form action={markPaidAction.bind(null, member.pageId, 1)}>
                    <ActionButton icon={<BadgeCheck />} small>
                      標記1個月
                    </ActionButton>
                  </form>
                  <form action={markPaidAction.bind(null, member.pageId, 3)}>
                    <ActionButton icon={<BadgeCheck />} small secondary>
                      標記3個月
                    </ActionButton>
                  </form>
                </InboxMemberCard>
              ))}
            </div>
          </InboxGroup>
        ) : null}

        {paymentIncomplete.length ? (
          <InboxGroup
            title="待補件"
            tone="warning"
            count={paymentIncomplete.length}
            viewHref="/admin?view=payment_incomplete"
          >
            <div className="inbox-cards">
              {paymentIncomplete.slice(0, INBOX_PREVIEW_LIMIT).map((member) => (
                <InboxMemberCard
                  key={member.pageId}
                  member={member}
                  detail={
                    member.paymentProofFileId ? "缺 UID 末四碼" : "缺轉帳截圖"
                  }
                >
                  <form action={requestPaymentProofAction.bind(null, member.pageId)}>
                    <ActionButton icon={<BadgeCheck />} small disabled={!member.telegramUserId}>
                      催件
                    </ActionButton>
                  </form>
                </InboxMemberCard>
              ))}
            </div>
          </InboxGroup>
        ) : null}

        {renewalDue.length ? (
          <InboxGroup
            title="到期未回"
            tone="warning"
            count={renewalDue.length}
            viewHref="/admin?status=renewal_due"
          >
            <div className="inbox-cards">
              {renewalDue.slice(0, INBOX_PREVIEW_LIMIT).map((member) => (
                <InboxMemberCard
                  key={member.pageId}
                  member={member}
                  detail={
                    member.renewalStep === "awaiting_trial_result"
                      ? "等學員按翻倉成功 / 尚未成功"
                      : member.renewalStep === "awaiting_pnl"
                        ? "等學員回覆合約收益狀況"
                        : "等學員選擇續費 / 不續留"
                  }
                >
                  <form action={resendRenewalDueReminderAction.bind(null, member.pageId)}>
                    <ActionButton icon={<BadgeCheck />} small disabled={!member.telegramUserId}>
                      重發提醒
                    </ActionButton>
                  </form>
                </InboxMemberCard>
              ))}
            </div>
          </InboxGroup>
        ) : null}

        {invitationPending.length ? (
          <InboxGroup
            title="待寄邀請 Email"
            tone="info"
            count={invitationPending.length}
            viewHref="/admin?view=invitation_pending"
          >
            <div className="inbox-summary-row">
              <p className="subtle small-text">
                {invitationPending.length} 位符合 status=eligible 且尚未寄出邀請的會員。
              </p>
              <CopyEmailListButton
                emails={invitationPending.map((member) => member.email).join("\n")}
              />
            </div>
          </InboxGroup>
        ) : null}
      </div>
    </section>
  );
}
