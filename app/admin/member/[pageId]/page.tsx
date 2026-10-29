import Link from "next/link";
import { DiscordAdminControls } from "@/app/admin/components/DiscordAdminControls";
import { isDiscordAdminConfigured } from "@/lib/discord-admin";
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
  recheckQualificationAction,
  approveHistoricalDepositAction,
  resetBoundAccountAction,
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
import { MembershipSummary, TelegramPresenceSummary } from "@/app/admin/components/MemberSummaries";
import { QualificationDetails } from "@/app/admin/components/QualificationSummary";
import { effectiveMembership, normalizeExchange, v2Enabled } from "@/lib/membership-v2";
import { hasTrustedPaidPeriod } from "@/app/admin/payment-policy";
import { isPaymentPending } from "@/lib/member-state";
import { DiscordDetails } from "@/app/admin/components/DiscordSummary";
import { isLegacyBitMartMember } from "@/lib/admin-views";
import { requireAdmin } from "@/lib/auth";
import { addMonths, formatDateTime, renewalBaseDate } from "@/lib/dates";
import { getMemberByPageId } from "@/lib/notion";
import { selectableStatuses, memberStatusLabel } from "@/lib/status";

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
          返回
        </Link>
        <p>找不到會員。</p>
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
  const isLegacyBitMart = isLegacyBitMartMember(member);

  const now = new Date();
  const policyV2 = v2Enabled();
  const manualStatuses = selectableStatuses();
  const base = policyV2 && !hasTrustedPaidPeriod(member, now) ? now : renewalBaseDate(member.reviewDueAt, now);
  const newDue1 = formatDateTime(addMonths(base, 1).toISOString());
  const newDue3 = formatDateTime(addMonths(base, 3).toISOString());

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>{member.telegramUserId || "會員"}</h1>
          <p className="subtle">{member.telegramUsername || "尚無使用者名稱"}</p>
        </div>
        <Link href="/admin" className="button secondary">
          <RefreshCw width={16} height={16} aria-hidden="true" />
          回列表
        </Link>
      </header>

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>會員資料</h2>
            <StatusBadge status={policyV2 ? effectiveMembership(member, now) : member.status} />
          </div>
          <div className="kv">
            <div>Telegram 帳號 ID</div>
            <div>{member.telegramUserId || "-"}</div>
            <div>Telegram 使用者名稱</div>
            <div>{member.telegramUsername || "-"}</div>
            <div>Email</div>
            <div>{member.email || "-"}</div>
            <DiscordDetails member={member} />
            <div>已送出邀請</div>
            <div>{member.invitationEmailSent ? "是" : "否"}</div>
            <div>會籍效期</div>
            <div><MembershipSummary member={member} /></div>
            <div>Telegram 入群紀錄</div>
            <div><TelegramPresenceSummary member={member} /></div>
            <div>Notion 原始標記</div>
            <div>{memberStatusLabel(member.status)}</div>
            <div>標籤</div>
            <div>{member.tags.length ? member.tags.join(", ") : "-"}</div>
            <div>推薦關係已驗證</div>
            <div>{member.exchangeRegistered ? "是" : "否"}</div>
            <div>交易所</div>
            <div>
              <div>{member.exchangeName || "-"}</div>
              {isLegacyBitMart ? (
                <div className="legacy-warning">
                  舊 BitMart 會員：續費付款已改由 MEXC 收款，審核 UID
                  末四碼時請以付款截圖 / MEXC 收款紀錄為準。
                </div>
              ) : null}
            </div>
            <div>交易所 UID</div>
            <div>{member.exchangeUid || "-"}</div>
            <div>UID 填寫時間</div>
            <div>{formatDateTime(member.uidSubmittedAt)}</div>
            <div>入群邀請連結</div>
            <div>{member.inviteLink || "-"}</div>
            <div>邀請連結期限</div>
            <div>{formatDateTime(member.inviteExpiresAt)}</div>
            <div>Telegram 首次入群時間</div>
            <div>{formatDateTime(member.groupJoinedAt)}</div>
            <div>{policyV2 ? "付費截止欄位（須核實付款）" : "會籍到期日"}</div>
            <div>{formatDateTime(member.reviewDueAt)}</div>
            <div>付款補件期限</div>
            <div>{formatDateTime(member.paymentDeadlineAt)}</div>
            <div>付款 UID 末四碼</div>
            <div>{member.paymentUidLast4 || "-"}</div>
            <div>付款證明</div>
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
                    alt="付款證明截圖"
                    style={{ maxWidth: "240px", borderRadius: "8px" }}
                  />
                </a>
              ) : (
                "-"
              )}
            </div>
            <div>付款證明檔案 ID</div>
            <div>{member.paymentProofFileId || "-"}</div>
            <div>付款證明送出時間</div>
            <div>{formatDateTime(member.paymentProofSubmittedAt)}</div>
            <div>核准付款時間</div>
            <div>{formatDateTime(member.paidAt)}</div>
            <div>付款申請進度</div>
            <div>{isPaymentPending(member) ? "申請付款中" : member.renewalStep === "payment_expired" ? "付款申請已截止" : "-"}</div>
            <div>7 天續約提醒</div>
            <div>{formatDateTime(member.renewalReminderSentAt)}</div>
            <div>3 天續約提醒</div>
            <div>{formatDateTime(member.renewalReminder3DaySentAt)}</div>
            <div>提醒對應到期日</div>
            <div>{formatDateTime(member.renewalReminderDueAt)}</div>
            <div>最後處理紀錄</div>
            <div>{member.lastBotMessage || "-"}</div>
            <div>會籍停用／歷史異動原因</div>
            <div>{member.kickReason || "-"}</div>
            <div>TradingView</div>
            <div>{member.tradingView || "-"}</div>
          </div>
        </section>

        <aside className="panel">
          <div className="panel-head">
            <h3>管理操作</h3>
          </div>
          <div className="stack">
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

            {policyV2 ? <p className="field-hint">僅在確認收款後核准 1 或 3 個月。已有有效付費期間者從原付費截止日續接；試用或未核實日期不會延長付款期限。特殊或停用會籍的優先規則保留。</p> : null}

            <form action={resendInvite}>
              <ActionButton icon={<Send />} disabled={!member.telegramUserId || ["suspended", "kicked", "denied"].includes(member.status)}>重送入群連結</ActionButton>
            </form>

            <div className="actions-divider" role="separator" aria-label="流程操作" />

            <form action={requestPaymentProof}>
              <ActionButton icon={<Upload />} secondary disabled={!member.telegramUserId}>
                重新付款
              </ActionButton>
            </form>

            <form action={markInvitationEmailSent}>
              <ActionButton icon={<Send />} secondary disabled={member.invitationEmailSent}>
                標記已送出邀請 Email
              </ActionButton>
            </form>

            {!policyV2 && !["active_paid", "partner", "exempt", "VIP"].includes(member.status) && (
              <form action={extendTrial}>
                <ActionButton icon={<CalendarPlus />} secondary small>
                  延長體驗期一個月
                </ActionButton>
              </form>
            )}

            {policyV2 ? <>
              <form action={recheckQualificationAction.bind(null,pageId)}><ActionButton icon={<RefreshCw />} secondary>重新檢查資格</ActionButton><p className="field-hint">依已開啟且完成資料範圍核對的交易所服務檢查；查詢失敗不會清除上次成功交易量資格。</p></form>
              <details className="advanced-actions">
                <summary>歷史入金人工覆核</summary>
                <form action={approveHistoricalDepositAction.bind(null,pageId)} className="stack">
                  <p className="field-hint">僅核准已有推薦關係證據的帳號；不能用此操作補造推薦關係。金額為已證明的歷史累計入金下限，之後提領不撤銷通過紀錄。</p>
                  <div className="field"><label htmlFor="verifiedDepositUsdt">已核實歷史累計入金（USDT）</label><input className="input" id="verifiedDepositUsdt" name="verifiedDepositUsdt" inputMode="decimal" required defaultValue={member.verifiedDepositUsdt ?? ""} /></div>
                  <div className="field"><label htmlFor="deposit-reason">覆核理由與證明依據（必填）</label><textarea className="input" id="deposit-reason" name="reason" required maxLength={1000} /></div>
                  <label><input type="checkbox" name="evidenceComplete" defaultChecked={member.depositEvidenceComplete} /> 已確認歷史入金資料完整</label>
                  <ActionButton icon={<Save />} secondary>確認歷史入金證據</ActionButton>
                </form>
              </details>
              <details className="advanced-actions">
                <summary>更換綁定交易所帳號</summary>
                <form action={resetBoundAccountAction.bind(null,pageId)} className="stack">
                  <p className="field-hint">更換後清除入群資格、入金與交易量證據，並撤銷舊邀請連結；付費事實與 Telegram 入群紀錄保留。需要 Discord 重新驗證，既有角色寫回保留供審核。</p>
                  <div className="field"><label htmlFor="bound-exchange">新綁定交易所</label><select className="input" id="bound-exchange" name="exchange" defaultValue={normalizeExchange(member.exchangeName) ?? ""} required><option value="" disabled>請選擇交易所</option><option value="mexc">MEXC</option><option value="bitget">Bitget</option><option value="okx">OKX</option></select></div>
                  <div className="field"><label htmlFor="bound-uid">新帳號 UID</label><input className="input" id="bound-uid" name="exchangeUid" inputMode="numeric" pattern="[0-9]{1,32}" maxLength={32} defaultValue={member.exchangeUid} required /></div>
                  <ActionButton icon={<Save />} danger>確認更換並重設資格</ActionButton>
                </form>
              </details>
            </> : null}

            <DiscordAdminControls pageId={pageId} discordId={member.discordId} verifiedAt={member.discordVerifiedAt} configured={isDiscordAdminConfigured()} />
            <details className="advanced-actions">
              <summary>進階操作</summary>
              <div className="stack">
                <form action={updateStatus} className="grid">
                  <div className="field">
                    <label htmlFor="status">手動修正會籍標記</label>
                    <select className="input" id="status" name="status" defaultValue={manualStatuses.some(status => status === member.status) ? member.status : ""}>
                      {!manualStatuses.some(status => status === member.status) && <option value="" disabled>請選擇手動狀態；目前標記：{memberStatusLabel(member.status)}</option>}
                      {manualStatuses.map((status) => (
                        <option key={status} value={status}>
                          {memberStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                    <p className="field-hint">僅修正狀態標記，不建立付費或交易量證據；實際權限仍依有效資料判定。若要標記付款，請用上方按鈕。</p>
                  </div>
                  <ActionButton icon={<Save />} danger>更新狀態</ActionButton>
                </form>

                <form action={revokeInvite}>
                  <ActionButton icon={<Link2Off />} danger disabled={!member.inviteLink}>
                    撤銷連結
                  </ActionButton>
                </form>

                <form action={clearInvite}>
                  <ActionButton icon={<Eraser />} danger>
                    清除連結欄位
                  </ActionButton>
                </form>

                <form action={kick}>
                  <ActionButton icon={<Ban />} danger>
                    停用會籍
                  </ActionButton>
                  <p className="field-hint">停用後 Telegram 群組資格會保留；Discord 等付費權益依 Notion 會籍處理。</p>
                </form>
              </div>
            </details>
          </div>
        </aside>
      </div>
      {policyV2 ? <QualificationDetails member={member} /> : null}
    </main>
  );
}
