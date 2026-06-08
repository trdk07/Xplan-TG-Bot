import Link from "next/link";
import {
  Ban,
  CalendarPlus,
  Eraser,
  Link2Off,
  RefreshCw,
  Save,
  Send,
  Upload,
} from "lucide-react";
import {
  clearInviteAction,
  extendTrialAction,
  kickMemberAction,
  markPaidAction,
  markInvitationEmailSentAction,
  requestPaymentProofAction,
  resendInviteAction,
  revokeInviteAction,
  updateStatusAction,
} from "@/app/admin/actions";
import { ActionButton } from "@/app/components/ActionButton";
import { ConfirmMarkPaidButton } from "@/app/components/ConfirmMarkPaidButton";
import { StatusBadge } from "@/app/components/StatusBadge";
import { requireAdmin } from "@/lib/auth";
import { addMonths, formatDateTime, renewalBaseDate } from "@/lib/dates";
import { getMemberByPageId } from "@/lib/notion";
import { manualOverrideStatuses, memberStatusLabel } from "@/lib/status";

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  await requireAdmin();
  const { pageId } = await params;
  const member = await getMemberByPageId(pageId);

  if (!member) {
    return (
      <main className="shell">
        <Link href="/admin" className="button secondary">
          Back
        </Link>
        <p>Member not found.</p>
      </main>
    );
  }

  const updateStatus = updateStatusAction.bind(null, pageId);
  const markPaidOneMonth = markPaidAction.bind(null, pageId, 1);
  const markPaidThreeMonths = markPaidAction.bind(null, pageId, 3);
  const requestPaymentProof = requestPaymentProofAction.bind(null, pageId);
  const markInvitationEmailSent = markInvitationEmailSentAction.bind(null, pageId);
  const extendTrial = extendTrialAction.bind(null, pageId);
  const kick = kickMemberAction.bind(null, pageId);
  const resendInvite = resendInviteAction.bind(null, pageId);
  const revokeInvite = revokeInviteAction.bind(null, pageId);
  const clearInvite = clearInviteAction.bind(null, pageId);
  const isLegacyBitMartMember = member.exchangeName
    .trim()
    .toLowerCase()
    .includes("bitmart");

  const now = new Date();
  const base = renewalBaseDate(member.reviewDueAt, now);
  const newDue1 = formatDateTime(addMonths(base, 1).toISOString());
  const newDue3 = formatDateTime(addMonths(base, 3).toISOString());

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>{member.telegramUserId || "Member"}</h1>
          <p className="subtle">{member.telegramUsername || "No username captured"}</p>
        </div>
        <Link href="/admin" className="button secondary">
          <RefreshCw width={16} height={16} aria-hidden="true" />
          回列表
        </Link>
      </header>

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Member Detail</h2>
            <StatusBadge status={member.status} />
          </div>
          <div className="kv">
            <div>Telegram User ID</div>
            <div>{member.telegramUserId || "-"}</div>
            <div>Telegram Username</div>
            <div>{member.telegramUsername || "-"}</div>
            <div>Email</div>
            <div>{member.email || "-"}</div>
            <div>已送出邀請</div>
            <div>{member.invitationEmailSent ? "yes" : "no"}</div>
            <div>Status</div>
            <div>{memberStatusLabel(member.status)}</div>
            <div>Tags</div>
            <div>{member.tags.length ? member.tags.join(", ") : "-"}</div>
            <div>Exchange Registered</div>
            <div>{member.exchangeRegistered ? "yes" : "no"}</div>
            <div>Exchange Name</div>
            <div>
              <div>{member.exchangeName || "-"}</div>
              {isLegacyBitMartMember ? (
                <div className="legacy-warning">
                  舊 BitMart 會員：續費付款已改由 MEXC 收款，審核 UID
                  末四碼時請以付款截圖 / MEXC 收款紀錄為準。
                </div>
              ) : null}
            </div>
            <div>Exchange UID</div>
            <div>{member.exchangeUid || "-"}</div>
            <div>UID Submitted At</div>
            <div>{formatDateTime(member.uidSubmittedAt)}</div>
            <div>Invite Link</div>
            <div>{member.inviteLink || "-"}</div>
            <div>Invite Expires At</div>
            <div>{formatDateTime(member.inviteExpiresAt)}</div>
            <div>Group Joined At</div>
            <div>{formatDateTime(member.groupJoinedAt)}</div>
            <div>Review Due At</div>
            <div>{formatDateTime(member.reviewDueAt)}</div>
            <div>Payment Deadline At</div>
            <div>{formatDateTime(member.paymentDeadlineAt)}</div>
            <div>Payment UID Last 4</div>
            <div>{member.paymentUidLast4 || "-"}</div>
            <div>Payment Proof</div>
            <div>
              {member.paymentProofFileId ? (
                <a
                  href={`/api/admin/payment-proof?fileId=${encodeURIComponent(
                    member.paymentProofFileId,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={`/api/admin/payment-proof?fileId=${encodeURIComponent(
                      member.paymentProofFileId,
                    )}`}
                    alt="Payment proof screenshot"
                    style={{ maxWidth: "240px", borderRadius: "8px" }}
                  />
                </a>
              ) : (
                "-"
              )}
            </div>
            <div>Payment Proof File ID</div>
            <div>{member.paymentProofFileId || "-"}</div>
            <div>Payment Proof Submitted At</div>
            <div>{formatDateTime(member.paymentProofSubmittedAt)}</div>
            <div>Paid At</div>
            <div>{formatDateTime(member.paidAt)}</div>
            <div>Final P/L</div>
            <div>{member.finalPnl || "-"}</div>
            <div>Renewal Step</div>
            <div>{member.renewalStep || "-"}</div>
            <div>Renewal Reminder Sent At</div>
            <div>{formatDateTime(member.renewalReminderSentAt)}</div>
            <div>Last Bot Message</div>
            <div>{member.lastBotMessage || "-"}</div>
            <div>Kick Reason</div>
            <div>{member.kickReason || "-"}</div>
            <div>TradingView</div>
            <div>{member.tradingView || "-"}</div>
          </div>
        </section>

        <aside className="panel">
          <div className="panel-head">
            <h3>Actions</h3>
          </div>
          <div className="stack">
            <form action={updateStatus} className="grid">
              <div className="field">
                <label htmlFor="status">手動修正 Status</label>
                <select className="input" id="status" name="status" defaultValue={member.status}>
                  {member.status === "active_paid" && (
                    <option value="active_paid" disabled>
                      已付款有效（請用下方標記付款按鈕）
                    </option>
                  )}
                  {manualOverrideStatuses.map((status) => (
                    <option key={status} value={status}>
                      {memberStatusLabel(status)}
                    </option>
                  ))}
                </select>
                <p className="field-hint">⚠️ 僅修正 Status 欄位，不會更新到期日或通知 Bot。若要標記付款，請用下方按鈕。</p>
              </div>
              <ActionButton icon={Save}>更新狀態</ActionButton>
            </form>

            <form action={markInvitationEmailSent}>
              <ActionButton icon={Send} secondary disabled={member.invitationEmailSent}>
                標記已送出邀請 Email
              </ActionButton>
            </form>

            <form action={requestPaymentProof}>
              <ActionButton icon={Upload} secondary disabled={!member.telegramUserId}>
                重新付款
              </ActionButton>
            </form>

            <form action={markPaidOneMonth}>
              <ConfirmMarkPaidButton
                label="標記已付款（1 個月）"
                previewDate={newDue1}
                confirmMessage={`確定要標記 ${member.telegramUsername || member.telegramUserId} 已付款 1 個月嗎？\n\n新的到期日將會是：${newDue1}`}
              />
            </form>

            <form action={markPaidThreeMonths}>
              <ConfirmMarkPaidButton
                label="標記已付款（3 個月）"
                previewDate={newDue3}
                confirmMessage={`確定要標記 ${member.telegramUsername || member.telegramUserId} 已付款 3 個月嗎？\n\n新的到期日將會是：${newDue3}`}
              />
            </form>

            <form action={resendInvite}>
              <ActionButton icon={Send} secondary>
                重送入群連結
              </ActionButton>
            </form>

            <form action={revokeInvite}>
              <ActionButton icon={Link2Off} secondary disabled={!member.inviteLink}>
                撤銷連結
              </ActionButton>
            </form>

            <form action={clearInvite}>
              <ActionButton icon={Eraser} secondary>
                清除連結欄位
              </ActionButton>
            </form>

            {!["active_paid", "partner", "exempt", "VIP"].includes(member.status) && (
              <form action={extendTrial}>
                <ActionButton icon={CalendarPlus} secondary small>
                  延長體驗期一個月
                </ActionButton>
              </form>
            )}

            <form action={kick}>
              <ActionButton icon={Ban} danger>
                踢出群組
              </ActionButton>
            </form>

          </div>
        </aside>
      </div>
    </main>
  );
}
