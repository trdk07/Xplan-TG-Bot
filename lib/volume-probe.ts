import type { VolumeProbe } from "@/lib/exchanges";
import {
  VOLUME_THRESHOLD_USDT,
  exchangeLabel,
  sumAmounts,
  volumeMeetsThreshold,
  type Exchange,
} from "@/lib/membership-v2";

export type VolumeProbeState = {
  kind: "idle" | "success" | "error";
  message: string;
  lines: string[];
};

const money = (value: string) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
const day = (time: number) =>
  new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));

/** Human-readable result of a read-only volume probe. Nothing here is persisted. */
export function describeVolumeProbe(
  exchange: Exchange,
  uid: string,
  window: { start: string; end: string },
  probe: VolumeProbe,
): VolumeProbeState {
  const other = probe.other ?? "0";
  const total = sumAmounts([probe.spot, probe.futures, other]);
  const qualified = volumeMeetsThreshold(probe.spot, probe.futures, other);
  const active = probe.days.filter((row) => row.total !== "0");
  return {
    kind: "success",
    message: `${exchangeLabel(exchange)} UID ${uid}：近 30 天合計 ${money(total)}，${
      qualified ? "已達" : "未達"
    } ${money(VOLUME_THRESHOLD_USDT)} 門檻`,
    lines: [
      `統計期間（台北時間）：${day(Date.parse(window.start))} ～ ${day(Date.parse(window.end) - 1)}`,
      `現貨：${money(probe.spot)}`,
      `合約：${money(probe.futures)}`,
      ...(other !== "0" ? [`其他（鏈上／CFD／美股等）：${money(other)}`] : []),
      ...(probe.days.length
        ? [
            `有成交的天數：${active.length} / ${probe.days.length}`,
            ...active.map(
              (row) =>
                `${day(row.time)}　現貨 ${money(row.spot)}　合約 ${money(row.futures)}　當日合計 ${money(row.total)}`,
            ),
          ]
        : []),
      "這是試查結果，不會寫入 Notion，也不會改變會員資格。金額單位以交易所回傳為準（待確認是否為 USDT）。",
    ],
  };
}
