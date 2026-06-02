import Link from "next/link";
import {
  BadgeCheck,
  BellRing,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  FileWarning,
  Filter,
  Upload,
  ImageIcon,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  logoutAction,
  requestPaymentProofAction,
  resendRenewalRemindersAction,
} from "@/app/admin/actions";
import { StatusBadge } from "@/app/components/StatusBadge";
import { getDisplayConfig, getMissingConfig } from "@/lib/config";
import { daysUntil, formatDateTime } from "@/lib/dates";
import {
  isPaymentFollowupCandidate,
  isPaymentReviewReady,
  isRenewalNoticeCandidate,
} from "@/lib/member-state";
import { listMembers, type Member } from "@/lib/notion";
import {
  memberStatusLabel,
  memberStatuses,
  type MemberStatus,
} from "@/lib/status";
import { requireAdmin } from "@/lib/auth";

function statCount(members: Member[], statuses: MemberStatus[]) {
  return members.filter((member) => statuses.includes(member.status)).length;
}

function scalar(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function isLegacyBitMartMember(member: Member) {
  return member.exchangeName.trim().toLowerCase().includes("bitmart");
}

function legacyBitMartReviewNote(member: Member) {
  return isLegacyBitMartMember(member)
    ? "舊 BitMart 會員，續費請用 MEXC 收款紀錄核對"
    : "";
}

function ExchangeSummary({ member }: { member: Member }) {
  const isLegacyBitMart = isLegacyBitMartMember(member);

  return (
    <div className="payment-review">
      <span>{member.exchangeName || "-"}</span>
      {isLegacyBitMart ? (
        <span className="mini-badge warning">舊會員｜續費改 MEXC</span>
      ) : null}
    </div>
  );
}

function paymentReviewState(member: Member) {
  const hasProof = Boolean(member.paymentProofFileId);
  const hasUid = Boolean(member.paymentUidLast4);

  if (member.status === "active_paid" || member.paidAt) {
    return {
      tone: "success",
      label: "已標記付款",
      detail: member.paidAt
        ? `付款時間：${formatDateTime(member.paidAt)}`
        : "會籍有效",
      icon: BadgeCheck,
    } as const;
  }

  if (member.status !== "payment_pending") {
    return null;
  }

  if (hasProof && hasUid) {
    return {
      tone: "warning",
      label: "待審核",
      detail: `UID 末四碼：${member.paymentUidLast4}`,
      icon: Clock3,
    } as const;
  }

  if (hasProof || hasUid) {
    return {
      tone: "warning",
      label: "待補件",
      detail: hasProof ? "缺 UID 末四碼" : "缺轉帳截圖",
      icon: FileWarning,
    } as const;
  }

  return {
    tone: "muted",
    label: "待付款資料",
    detail: "尚未收到截圖與 UID 末四碼",
    icon: Clock3,
  } as const;
}

function DateStack({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="date-stack">
      <span className="mobile-label">{label}</span>
      <span>{formatDateTime(value)}</span>
    </div>
  );
}

function PaymentReviewSummary({ member }: { member: Member }) {
  const state = paymentReviewState(member);
  if (!state) return <span className="subtle">-</span>;

  const Icon = state.icon;
  return (
    <div className="payment-review">
      <span className={`mini-badge ${state.tone}`}>
        <Icon width={14} height={14} aria-hidden="true" />
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

function renewalReviewState(member: Member) {
  const days = daysUntil(member.reviewDueAt);
  const dueText =
    days === null
      ? "-"
      : days < 0
        ? `已逾期 ${Math.abs(days)} 天`
        : `剩 ${days} 天`;

  if (member.status === "renewal_due") {
    if (member.renewalStep === "awaiting_trial_result") {
      return {
        tone: "warning",
        label: "待選翻倉",
        detail: "等學員按翻倉成功 / 尚未成功",
        icon: Clock3,
      } as const;
    }

    if (member.renewalStep === "awaiting_pnl") {
      return {
        tone: "warning",
        label: "待回覆收益",
        detail: "等學員回覆合約收益狀況",
        icon: Clock3,
      } as const;
    }

    return {
      tone: "warning",
      label: "待選續留",
      detail: member.finalPnl
        ? "已回覆收益，等續留選擇"
        : "等學員選擇續費 / 不續留",
      icon: Clock3,
    } as const;
  }

  if (member.status === "payment_pending") {
    return {
      tone: "warning",
      label: "已申請續費",
      detail: "等付款資料或助理審核",
      icon: CircleDollarSign,
    } as const;
  }

  if (member.status === "active_paid") {
    return {
      tone: "success",
      label: "已續約有效",
      detail: member.reviewDueAt
        ? `有效期限：${formatDateTime(member.reviewDueAt)}`
        : "會籍有效",
      icon: BadgeCheck,
    } as const;
  }

  if (member.status === "trial_active") {
    if (days !== null && days >= 0 && days <= 7) {
      return {
        tone: "warning",
        label: member.renewalReminderSentAt ? "已提醒續約" : "即將到期",
        detail: dueText,
        icon: CalendarClock,
      } as const;
    }

    return {
      tone: "muted",
      label: "體驗進行中",
      detail: member.reviewDueAt
        ? `到期：${formatDateTime(member.reviewDueAt)}`
        : "尚無到期日",
      icon: CalendarClock,
    } as const;
  }

  if (member.kickReason === "user_declined_renewal") {
    return {
      tone: "danger",
      label: "不續留",
      detail: "學員已選擇暫時不續留",
      icon: FileWarning,
    } as const;
  }

  if (member.status === "expired") {
    return {
      tone: "danger",
      label: "逾期未完成",
      detail: member.kickReason || "續約或付款期限已過",
      icon: FileWarning,
    } as const;
  }

  if (
    member.status === "partner" ||
    member.status === "exempt" ||
    member.status === "VIP"
  ) {
    return {
      tone: "success",
      label: "免續約",
      detail: "不進入續約到期流程",
      icon: BadgeCheck,
    } as const;
  }

  return null;
}

function RenewalReviewSummary({ member }: { member: Member }) {
  const state = renewalReviewState(member);
  if (!state) return <span className="subtle">-</span>;

  const Icon = state.icon;
  return (
    <div className="payment-review">
      <span className={`mini-badge ${state.tone}`}>
        <Icon width={14} height={14} aria-hidden="true" />
        {state.label}
      </span>
      <span className="subtle small-text">{state.detail}</span>
    </div>
  );
}

function TradingViewSummary({ member }: { member: Member }) {
  if (!member.tradingView) return null;
  const isInactive = member.status === "expired" || member.status === "kicked";
  if (!isInactive) return null;

  return (
    <div className="review-block">
      <span className="mobile-label">TradingView</span>
      <div className="payment-review">
        <span className="compact-text">{member.tradingView}</span>
        {member.tradingViewAccess === "待撤銷" ? (
          <span className="mini-badge danger">待撤銷</span>
        ) : member.tradingViewAccess === "已撤銷" ? (
          <span className="mini-badge muted">已撤銷</span>
        ) : (
          <span className="mini-badge warning">未標記</span>
        )}
      </div>
    </div>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    status?: string | string[];
    resent?: string | string[];
    inactive?: string | string[];
  }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const q = scalar(params.q);
  const rawStatus = scalar(params.status);
  const resentCount = scalar(params.resent);
  const inactive = scalar(params.inactive);
  const status = memberStatuses.includes(rawStatus as MemberStatus)
    ? (rawStatus as MemberStatus)
    : "all";
  const config = getDisplayConfig();
  const missingConfig = getMissingConfig();

  let members: Member[] = [];
  let loadError = "";
  try {
    members = await listMembers({ status, query: q, limit: 500 });
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Unable to load members";
  }

  const tvPendingRevoke = members.filter(
    (m) => m.tradingViewAccess === "待撤銷",
  ).length;

  const displayMembers =
    inactive === "show"
      ? members
      : members.filter(
          (m) => !["expired", "kicked", "denied"].includes(m.status),
        );
  const hiddenCount = members.length - displayMembers.length;

  const paymentProofReady = members.filter(
    (member) => isPaymentReviewReady(member),
  ).length;
  const renewalWaiting = members.filter(
    (member) => member.status === "renewal_due",
  ).length;

  const now = new Date();
  const renewalNoticeTargets = members.filter((member) =>
    isRenewalNoticeCandidate(member, now, {
      allowAlreadyReminded: true,
    }),
  ).length;
  const paymentFollowupTargets = members.filter((member) =>
    isPaymentFollowupCandidate(member, now),
  ).length;
  const endingSoon = renewalNoticeTargets + paymentFollowupTargets;
  const invitationEmailTargets = members.filter(
    (member) =>
      member.status === "eligible" &&
      member.email &&
      !member.invitationEmailSent,
  );
  const invitationEmailList = invitationEmailTargets
    .map((member) => member.email)
    .join("\n");

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Telegram 會員入群 Bot</h1>
          <p className="subtle">
            Notion-only membership gate and renewal dashboard.
          </p>
        </div>
        <form action={logoutAction}>
          <button className="button secondary" type="submit">
            <LogOut width={16} height={16} aria-hidden="true" />
            登出
          </button>
        </form>
      </header>

      <section className="grid stats">
        <div className="stat">
          <span className="subtle">Loaded Members</span>
          <strong>{members.length}</strong>
        </div>
        <div className="stat">
          <span className="subtle">Active</span>
          <strong>{statCount(members, ["trial_active", "active_paid"])}</strong>
        </div>
        <div className="stat">
          <span className="subtle">Payment Pending</span>
          <strong>{statCount(members, ["payment_pending"])}</strong>
        </div>
        <div className="stat stat-emphasis">
          <span className="subtle">待續留回覆</span>
          <strong>{renewalWaiting}</strong>
        </div>
        <div className="stat stat-emphasis">
          <span className="subtle">待審核付款</span>
          <strong>{paymentProofReady}</strong>
        </div>
        <div className="stat">
          <span className="subtle">Ending Soon</span>
          <strong>{endingSoon}</strong>
        </div>
        <div className="stat stat-emphasis">
          <span className="subtle">待寄邀請 Email</span>
          <strong>{invitationEmailTargets.length}</strong>
        </div>
        <div className="stat stat-emphasis">
          <span className="subtle">TradingView 待撤銷</span>
          <strong>{tvPendingRevoke}</strong>
        </div>
      </section>

      {resentCount ? (
        <div className="notice success" role="status">
          已重新發送最新版續約通知給 {resentCount} 位 0～7 天內到期的會員。
        </div>
      ) : null}

      <section className="panel action-panel">
        <div className="panel-head">
          <h2>
            <BellRing width={16} height={16} aria-hidden="true" /> 續約通知重發
          </h2>
          <span className="subtle">目前可提醒：{endingSoon} 位</span>
        </div>
        <div className="panel-body action-row">
          <div>
            <strong>重新發送最新版即將到期續約通知</strong>
            <p className="subtle">
              會發給 0～7 天內到期、尚未進入續費流程的會員；若會員已在付款流程中，
              只會提醒尚未補齊截圖或 UID 末四碼的人。已付款、待助理審核、已撤銷者會略過。
            </p>
          </div>
          <form action={resendRenewalRemindersAction}>
            <button className="button" type="submit">
              <BellRing width={16} height={16} aria-hidden="true" />
              重新發送即將到期續約通知
            </button>
          </form>
        </div>
      </section>

      <section className="panel action-panel">
        <div className="panel-head">
          <h2>入群申請工具</h2>
          <Link className="button secondary" href="/admin/applications">
            MEXC CSV 雙向比對
          </Link>
        </div>
        <div className="panel-body">
          <p className="subtle">
            截止申請後可貼上 MEXC 後台下載的 CSV，和 Notion/Tally 名單快速比對，並批次標記可入群。
          </p>
        </div>
      </section>

      <section className="panel action-panel">
        <div className="panel-head">
          <h2>邀請 Email 名單</h2>
          <span className="subtle">待寄：{invitationEmailTargets.length} 位</span>
        </div>
        <div className="panel-body">
          <p className="subtle">
            來源為 Notion 的 email 欄位；只列出 status = eligible 且尚未勾選「已送出邀請」的會員。
            可直接複製下方名單到人工寄信工具。
          </p>
          <textarea
            className="input email-copy-box"
            readOnly
            value={invitationEmailList}
            aria-label="待寄邀請 Email 名單"
          />
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <h2>
            <Settings width={16} height={16} aria-hidden="true" /> Settings
          </h2>
          <span className="subtle">
            {missingConfig.length
              ? `Missing: ${missingConfig.join(", ")}`
              : "Config OK"}
          </span>
        </div>
        <div className="kv">
          <div>Exchange</div>
          <div>{config.exchangeName}</div>
          <div>Telegram Group</div>
          <div>{config.telegramGroupId || "-"}</div>
          <div>Notion Data Source</div>
          <div>{config.notionDataSourceId || "-"}</div>
          <div>Trial / Grace</div>
          <div>
            {config.trialDays} days / {config.paymentGraceDays} days
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>
            <Users width={16} height={16} aria-hidden="true" /> Members
          </h2>
          <span className="subtle">{loadError || "Synced from Notion"}</span>
        </div>

        <form className="toolbar">
          <div className="field">
            <label htmlFor="q">Search</label>
            <input
              className="input"
              id="q"
              name="q"
              defaultValue={q}
              placeholder="Telegram ID, username, email, UID..."
            />
          </div>
          <div className="field">
            <label htmlFor="status">Status</label>
            <select
              className="input"
              id="status"
              name="status"
              defaultValue={status}
            >
              <option value="all">all</option>
              {memberStatuses.map((item) => (
                <option key={item} value={item}>
                  {memberStatusLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <button className="button" type="submit">
            <Search width={16} height={16} aria-hidden="true" />
            搜尋
          </button>
        </form>

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
                    <span className="mini-badge success">邀請已送出</span>
                  ) : (
                    <span className="mini-badge muted">邀請未送出</span>
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
                  <button
                    className="button secondary"
                    disabled={!member.telegramUserId}
                    type="submit"
                  >
                    <Upload width={16} height={16} aria-hidden="true" />
                    請 Bot 發補傳選項
                  </button>
                </form>
                <Link
                  className="button secondary"
                  href={`/admin/member/${member.pageId}`}
                >
                  <Filter width={16} height={16} aria-hidden="true" />
                  管理
                </Link>
              </div>
            </article>
          ))}
          {!members.length ? (
            <div className="empty-state subtle">沒有符合條件的會員。</div>
          ) : null}
        </div>
      </section>

      <section className="grid stats" style={{ marginTop: 20 }}>
        <div className="stat">
          <ShieldCheck width={20} height={20} aria-hidden="true" />
          <span className="subtle">Gate</span>
          <strong>Join Request</strong>
        </div>
        <div className="stat">
          <CircleDollarSign width={20} height={20} aria-hidden="true" />
          <span className="subtle">Payment</span>
          <strong>Pseudocode</strong>
        </div>
      </section>
    </main>
  );
}
