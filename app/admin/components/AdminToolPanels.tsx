import Link from "next/link";
import { v2Enabled } from "@/lib/membership-v2";
import { BellRing } from "lucide-react";
import { resendRenewalRemindersAction } from "@/app/admin/actions";
import { ActionButton } from "@/app/components/ActionButton";

type Props = {
  endingSoon: number;
  invitationEmailCount: number;
  invitationEmailList: string;
};

export function AdminToolPanels({
  endingSoon,
  invitationEmailCount,
  invitationEmailList,
}: Props) {
  return (
    <>
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
              {v2Enabled() ? "僅處理有效付費期間的 7 天／3 天提醒；以到期日與階段去重，已發送或傳送結果不明的通知不會盲目重送。1 個月或 3 個月續約須由助理確認付款，付款補件請逐筆處理。" : "會發給 7 天內到期且會籍仍有效的會員，也會提醒付款資料尚未完整的人補件。"}
              通知不變更原付費到期日；會籍到期後仍保留 Telegram 群組資格。
            </p>
          </div>
          <form action={resendRenewalRemindersAction}>
            <ActionButton icon={<BellRing />}>重新發送即將到期續約通知</ActionButton>
          </form>
        </div>
      </section>

      <section className="panel action-panel">
        <div className="panel-head">
          <h2>備援工具</h2>
          <Link className="button secondary" href="/admin/applications">
            MEXC CSV 雙向比對
          </Link>
        </div>
        <div className="panel-body">
          <p className="subtle">
            {v2Enabled() ? "CSV 只能比對同一交易所的 UID，無法證明推薦關係或歷史入金。匹配者僅列入人工覆核，不會核准資格或授予會籍。" : "Bot 正常運作時不需使用。若 MEXC API 無法驗證，可用此工具人工比對後手動標記可入群。"}
          </p>
        </div>
      </section>

      <section className="panel action-panel">
        <div className="panel-head">
          <h2>邀請 Email 名單</h2>
          <span className="subtle">待寄：{invitationEmailCount} 位</span>
        </div>
        <div className="panel-body">
          <p className="subtle">
            {v2Enabled() ? "只列出已核實入群資格、入群流程為可入群且尚未寄送邀請的會員。" : "來源為 Notion 的 email 欄位；只列出 status = eligible 且尚未勾選「已送出邀請」的會員。"}
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
    </>
  );
}
