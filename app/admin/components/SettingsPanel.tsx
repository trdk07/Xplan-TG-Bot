import { v2Enabled } from "@/lib/membership-v2";
import { Settings } from "lucide-react";
import type { getDisplayConfig } from "@/lib/config";

type Props = {
  config: ReturnType<typeof getDisplayConfig>;
  missingConfig: string[];
};

export function SettingsPanel({ config, missingConfig }: Props) {
  const providers = (["MEXC", "Bitget", "OKX"] as const).map(label => {
    const prefix = label.toUpperCase();
    const admission = process.env[`${prefix}_ADMISSION_ENABLED`] === "true";
    const enabled = process.env[`${prefix}_VOLUME_ENABLED`] === "true";
    const verified = ["UNIT", "COVERAGE", "WINDOW"].every(kind => process.env[`${prefix}_VOLUME_${kind}_VERIFIED`] === "true");
    return `${label}：入群${admission ? "啟用" : "關閉"}／交易量${!enabled ? "關閉" : verified ? "啟用" : "待核實"}`;
  });
  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head">
        <h2>
          <Settings width={16} height={16} aria-hidden="true" /> 設定
        </h2>
        <span className="subtle">
          {missingConfig.length
            ? `缺少：${missingConfig.join(", ")}`
            : "設定齊全"}
        </span>
      </div>
      <div className="kv">
        <div>交易所</div>
        <div>{config.exchangeName}</div>
        <div>Telegram 群組</div>
        <div>{config.telegramGroupId || "-"}</div>
        <div>Notion 資料來源</div>
        <div>{config.notionDataSourceId || "-"}</div>
        <div>會員政策 V2</div><div>{v2Enabled() ? "已啟用" : "未啟用（保留舊版流程）"}</div>
        {v2Enabled() ? <><div>交易所檢查開關</div><div className="stack">{providers.map(provider => <span key={provider}>{provider}</span>)}</div><div>付費方案／補件期限</div><div>1 個月或 3 個月／{config.paymentGraceDays} 天；沒有試用期</div><div>資格檢查</div><div>每日台北時間 09:00；交易量 API 預設關閉，須先完成資料範圍與單位核對</div></> : <><div>Trial / Grace</div><div>{config.trialDays} days / {config.paymentGraceDays} days</div></>}
      </div>
    </section>
  );
}
