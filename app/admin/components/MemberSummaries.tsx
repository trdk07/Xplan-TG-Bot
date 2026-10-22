import { ImageIcon } from "lucide-react";
import { formatDateTime } from "@/lib/dates";
import type { Member } from "@/lib/notion";
import { getMembershipState } from "@/lib/member-state";
import {
  isLegacyBitMartMember,
  legacyBitMartReviewNote,
  paymentReviewState,
  renewalReviewState,
} from "@/lib/admin-views";

export function ExchangeSummary({ member }: { member: Member }) {
  const isLegacyBitMart = isLegacyBitMartMember(member);

  return (
    <div className="payment-review">
      <span>{member.exchangeName || "-"}</span>
      {isLegacyBitMart ? (
        <span className="mini-badge warning">
          <span className="badge-dot" aria-hidden="true" />
          舊會員｜續費改 MEXC
        </span>
      ) : null}
    </div>
  );
}

export function DateStack({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="date-stack">
      <span className="mobile-label">{label}</span>
      <span>{formatDateTime(value)}</span>
    </div>
  );
}

export function PaymentReviewSummary({ member }: { member: Member }) {
  const state = paymentReviewState(member);
  if (!state) return <span className="subtle">-</span>;

  return (
    <div className="payment-review">
      <span className={`mini-badge ${state.tone}`}>
        <span className="badge-dot" aria-hidden="true" />
        {state.label}
      </span>
      <span className="subtle small-text">{state.detail}</span>
      {legacyBitMartReviewNote(member) ? (
        <span className="legacy-note">{legacyBitMartReviewNote(member)}</span>
      ) : null}
      {member.paymentProofFileId ? (
        <a
          className="proof-link"
          href={`/api/admin/payment-proof?fileId=${encodeURIComponent(
            member.paymentProofFileId,
          )}`}
          target="_blank"
          rel="noreferrer"
        >
          <ImageIcon width={14} height={14} aria-hidden="true" />
          看截圖
        </a>
      ) : null}
    </div>
  );
}

export function RenewalReviewSummary({ member }: { member: Member }) {
  const state = renewalReviewState(member);
  return (
    <div className="payment-review">
      {state ? <>
        <span className={`mini-badge ${state.tone}`}>
          <span className="badge-dot" aria-hidden="true" />
          {state.label}
        </span>
        <span className="subtle small-text">{state.detail}</span>
      </> : <span className="subtle">尚未進入續約</span>}
      <span className="subtle small-text">7 天續約提醒：{formatDateTime(member.renewalReminderSentAt)}</span>
      <span className="subtle small-text">3 天續約提醒：{formatDateTime(member.renewalReminder3DaySentAt)}</span>
    </div>
  );
}

export function TradingViewSummary({ member }: { member: Member }) {
  if (!member.tradingView) return null;
  const isInactive = member.status === "expired" || member.status === "kicked";
  if (!isInactive) return null;

  return (
    <div className="review-block">
      <span className="mobile-label">TradingView</span>
      <div className="payment-review">
        <span className="compact-text">{member.tradingView}</span>
      </div>
    </div>
  );
}


export function MembershipSummary({ member }: { member: Member }) {
  const state = getMembershipState(member);
  return <span className={`mini-badge ${state.tone}`}><span className="badge-dot" aria-hidden="true" />{state.label}</span>;
}

export function TelegramPresenceSummary({ member }: { member: Member }) {
  return (
    <div className="payment-review">
      <span className={`mini-badge ${member.groupJoinedAt ? "success" : "muted"}`}>
        <span className="badge-dot" aria-hidden="true" />
        {member.groupJoinedAt ? "曾加入 Telegram" : "尚無 Telegram 入群紀錄"}
      </span>
      <span className="subtle small-text">入群紀錄不代表目前仍在群組；會籍到期不移出群組</span>
    </div>
  );
}
