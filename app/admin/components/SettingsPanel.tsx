import { Settings } from "lucide-react";
import type { getDisplayConfig } from "@/lib/config";

type Props = {
  config: ReturnType<typeof getDisplayConfig>;
  missingConfig: string[];
};

export function SettingsPanel({ config, missingConfig }: Props) {
  return (
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
  );
}
