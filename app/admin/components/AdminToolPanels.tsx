import Link from "next/link";
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
              會發給 0～7 天內到期、尚未進入續費流程的會員；若會員已在付款流程中，
              只會提醒尚未補齊截圖或 UID 末四碼的人。已付款、待助理審核、已撤銷者會略過。
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
            Bot 正常運作時不需使用。若 MEXC API 無法驗證，可用此工具人工比對後手動標記可入群。
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
    </>
  );
}
