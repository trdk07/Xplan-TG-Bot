import Link from "next/link";
import { formatDateTime } from "@/lib/dates";
import { effectiveMembership, validPastDate } from "@/lib/membership-v2";
import type { Member } from "@/lib/notion";

const amount = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 8 }) : "尚無資料";
function unboundPremiumDiscord(member: Member, now: Date) {
  return ["宇航員", "飛行員", "astronaut", "pilot"].includes(member.discordRole?.trim().toLowerCase() ?? "")
    && (!member.discordId.trim() || !validPastDate(member.discordVerifiedAt, now));
}
export function qualificationNeedsReview(member: Member, now = new Date()) {
  return unboundPremiumDiscord(member,now) || member.qualificationFieldsAvailable === false || member.onboardingStep === "needs_review"
    || Boolean(member.volumeCheckError) || (!validPastDate(member.admissionVerifiedAt, now) && Boolean(member.depositReviewReason));
}
function staleVolume(member: Member, now: Date) {
  return Boolean(member.volumeCheckError) || (validPastDate(member.volumeCheckedAt, now) && now.getTime() - Date.parse(member.volumeCheckedAt!) > 86_400_000);
}

export function QualificationSummary({ member, now = new Date() }: { member: Member; now?: Date }) {
  const admitted = validPastDate(member.admissionVerifiedAt, now);
  const stale = staleVolume(member, now);
  return (
    <div className="payment-review">
      <span className={`mini-badge ${admitted ? "success" : "warning"}`}>{admitted ? "入群資格已核實" : "入群資格待核對"}</span>
      <span className="subtle small-text">歷史入金下限：{amount(member.verifiedDepositUsdt)} USDT</span>
      <span className="small-text">30 日成交額：{amount(member.volumeTotal30d)} USDT</span>
      <span className={`mini-badge ${stale ? "warning" : "muted"}`}>{stale ? "上次成功資料（待更新）" : "交易量最後成功資料"}</span>
      <span className="subtle small-text">最後成功：{formatDateTime(member.volumeCheckedAt ?? null)}</span>
      {member.volumeCheckError ? <span className="small-text">查詢異常：{member.volumeCheckError}</span> : null}
    </div>
  );
}

export function QualificationDetails({ member }: { member: Member }) {
  const now = new Date();
  const effective = effectiveMembership(member, now);
  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="panel-head"><h2>入群與交易量資格證據</h2></div>
      <QualificationSummary member={member} now={now} />
      {member.qualificationFieldsAvailable === false ? <p className="notice warning">Notion 新版資格欄位尚未備妥，請先完成設定。</p> : null}
      <div className="kv" style={{ marginTop: 16 }}>
        <div>入群流程</div><div>{({collecting_info:"待蒐集資料",eligible:"資格已核實",join_pending:"待入群",joined:"已加入",needs_review:"待人工覆核"} as Record<string,string>)[member.onboardingStep ?? ""] ?? "尚無資料"}</div>
        <div>入群資格核實時間</div><div>{formatDateTime(member.admissionVerifiedAt ?? null)}</div>
        <div>歷史入金資料完整性</div><div>{member.depositEvidenceComplete ? "已確認完整" : "歷史資料不完整或尚未確認；已證明達 100 USDT 即可覆核"}</div>
        <div>入金覆核依據</div><div>{member.depositReviewReason || "尚無覆核紀錄"}</div>
        <div>覆核人／時間</div><div>{member.depositReviewedBy || "尚無紀錄"}／{formatDateTime(member.depositReviewedAt ?? null)}</div>
        <div>30 日現貨成交額</div><div>{amount(member.volumeSpot30d)} USDT</div>
        <div>30 日合約成交額</div><div>{amount(member.volumeFutures30d)} USDT</div>
        <div>交易量資格</div><div>{member.volumeQualified && validPastDate(member.admissionVerifiedAt,now) && validPastDate(member.volumeCheckedAt,now) ? "上次成功核實達標" : "尚無有效達標證據"}</div>
        <div>統計起日（含）</div><div>{formatDateTime(member.volumeWindowStart ?? null)}</div>
        <div>統計迄日（不含）</div><div>{formatDateTime(member.volumeWindowEnd ?? null)}</div>
        <div>最後嘗試檢查</div><div>{formatDateTime(member.qualificationCheckedAt ?? null)}</div>
        <div>捉妖小道權限</div><div>{["active_paid","partner","exempt","VIP"].includes(effective) ? "符合有效付費或特殊會籍條件" : "未符合有效付費或特殊會籍條件"}</div>
      </div>
      <p className="field-hint">成交額為單一綁定帳號、前 30 個完整台北日的現貨與合約合計；每天 09:00 檢查，達 200,000 USDT 才取得交易量資格。API 異常保留上次成功資格，付費期限仍獨立到期。</p>
      <p className="field-hint">Discord 身分組僅顯示 Notion 寫回結果，不以會籍推測已套用角色。</p>
    </section>
  );
}

export function QualificationReviewQueue({ members }: { members: Member[] }) {
  const review = members.filter(member => qualificationNeedsReview(member));
  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head"><h2>資格待覆核</h2><span className="subtle">{review.length} 位</span></div>
      <div className="stack">
        {review.length ? review.map(member => <article key={member.pageId} className="review-card"><Link href={`/admin/member/${member.pageId}`}>{member.telegramUsername || member.email || member.telegramUserId || "查看會員"}</Link><p className="subtle">{member.depositReviewReason || (member.qualificationFieldsAvailable === false ? "新版資料欄位尚未備妥" : member.volumeCheckError ? "交易量查詢異常，保留上次成功證據" : "入群或 Discord 驗證紀錄待確認")}</p>{member.volumeCheckError ? <p className="subtle">{member.volumeCheckError}</p> : null}{unboundPremiumDiscord(member,new Date()) ? <p className="subtle">Discord 身分組待覆核：已有進階角色但缺少完整綁定驗證紀錄，請人工確認；不自動移除。</p> : null}</article>) : <p className="subtle">目前沒有待人工覆核的資格紀錄。</p>}
      </div>
    </section>
  );
}
