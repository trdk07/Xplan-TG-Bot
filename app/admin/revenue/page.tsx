import Link from "next/link";
import { RefreshCw } from "lucide-react";
import {
  memberRevenue,
  monthlyRevenue,
  renewalConversionRate,
} from "@/lib/admin-views";
import { requireAdmin } from "@/lib/auth";
import { listMembers, type Member } from "@/lib/notion";

export default async function RevenuePage() {
  await requireAdmin();

  let members: Member[] = [];
  let loadError = "";
  try {
    members = await listMembers({ limit: 500 });
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Unable to load members";
  }

  const paidMembers = members.filter((m) => m.paidAt);
  const totalRevenue = paidMembers.reduce(
    (sum, m) => sum + memberRevenue(m),
    0,
  );
  const oneMonthCount = paidMembers.filter(
    (m) => m.subscriptionMonths === 1,
  ).length;
  const threeMonthCount = paidMembers.filter(
    (m) => m.subscriptionMonths === 3,
  ).length;
  const planTotal = oneMonthCount + threeMonthCount;
  const conversionRate = renewalConversionRate(members);
  const months = monthlyRevenue(members, 12);
  const maxRevenue = Math.max(1, ...months.map((m) => m.revenue));

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>收入報表</h1>
          <p className="subtle">依 Notion 付款紀錄彙整，僅供內部參考。</p>
        </div>
        <Link className="button secondary" href="/admin">
          <RefreshCw width={16} height={16} aria-hidden="true" />
          回後台
        </Link>
      </header>

      <section className="grid stats" style={{ marginBottom: 20 }}>
        <div className="stat">
          <span className="subtle">累計收款</span>
          <strong>{totalRevenue} U</strong>
        </div>
        <div className="stat">
          <span className="subtle">付費人數</span>
          <strong>{paidMembers.length} 位</strong>
        </div>
        <div className="stat">
          <span className="subtle">續約率（付費／可續約會員）</span>
          <strong>{conversionRate}%</strong>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <h2>方案佔比</h2>
          <span className="subtle">共 {planTotal} 筆付款</span>
        </div>
        <div className="panel-body">
          {planTotal ? (
            <>
              <div className="plan-split-bar">
                <span
                  className="plan-split-segment plan-split-1mo"
                  style={{ width: `${(oneMonthCount / planTotal) * 100}%` }}
                />
                <span
                  className="plan-split-segment plan-split-3mo"
                  style={{ width: `${(threeMonthCount / planTotal) * 100}%` }}
                />
              </div>
              <div className="plan-split-legend">
                <span>
                  <span className="legend-dot legend-dot-1mo" aria-hidden="true" />
                  1 個月（{oneMonthCount}）
                </span>
                <span>
                  <span className="legend-dot legend-dot-3mo" aria-hidden="true" />
                  3 個月（{threeMonthCount}）
                </span>
              </div>
            </>
          ) : (
            <p className="subtle">尚無付款紀錄。</p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>近 12 個月收入</h2>
          <span className="subtle">{loadError || "Synced from Notion"}</span>
        </div>
        <div className="panel-body">
          {months.length ? (
            <div className="revenue-chart">
              {months.map(({ month, revenue }) => (
                <div className="revenue-row" key={month}>
                  <span className="revenue-month">{month}</span>
                  <div className="revenue-bar-track">
                    <div
                      className="revenue-bar-fill"
                      style={{ width: `${(revenue / maxRevenue) * 100}%` }}
                    />
                  </div>
                  <span className="revenue-value">{revenue} U</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="subtle">尚無付款紀錄。</p>
          )}
        </div>
      </section>
    </main>
  );
}
