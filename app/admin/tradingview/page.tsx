import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listMembers, type Member } from "@/lib/notion";

export default async function TradingViewPage() {
  await requireAdmin();

  const members = await listMembers({ limit: 500 });

  const tvMembers = members.filter((m) => m.tradingView);

  const trialStatuses = new Set(["trial_active", "sent_7day_survey", "sent_3day_offer"]);

  const activePaid1Month: Member[] = [];
  const activePaid3Month: Member[] = [];
  const activePaidUnclassified: Member[] = [];
  const trial: Member[] = [];

  for (const m of tvMembers) {
    if (m.status === "active_paid") {
      if (m.subscriptionMonths === 1) {
        activePaid1Month.push(m);
      } else if (m.subscriptionMonths === 3) {
        activePaid3Month.push(m);
      } else {
        activePaidUnclassified.push(m);
      }
    } else if (trialStatuses.has(m.status)) {
      trial.push(m);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>TradingView 名單</h1>
          <p className="subtle">有 TradingView 帳號的會員列表</p>
        </div>
        <Link className="button secondary" href="/admin">
          返回主頁
        </Link>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2>訂閱中（訂閱 1 個月）</h2>
          <span className="subtle">{activePaid1Month.length} 位</span>
        </div>
        <div className="panel-body">
          <TradingViewList members={activePaid1Month} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>訂閱中（訂閱 3 個月）</h2>
          <span className="subtle">{activePaid3Month.length} 位</span>
        </div>
        <div className="panel-body">
          <TradingViewList members={activePaid3Month} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>體驗期</h2>
          <span className="subtle">{trial.length} 位</span>
        </div>
        <div className="panel-body">
          <TradingViewList members={trial} />
        </div>
      </section>

      {activePaidUnclassified.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <h2>未分類（訂閱中，無訂閱月數）</h2>
            <span className="subtle">{activePaidUnclassified.length} 位</span>
          </div>
          <div className="panel-body">
            <TradingViewList members={activePaidUnclassified} />
          </div>
        </section>
      ) : null}
    </main>
  );
}

function TradingViewList({ members }: { members: Member[] }) {
  if (!members.length) {
    return <p className="subtle">（無）</p>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", padding: "6px 8px" }}>TradingView 帳號</th>
          <th style={{ textAlign: "left", padding: "6px 8px" }}>Telegram 帳號</th>
          <th style={{ textAlign: "left", padding: "6px 8px" }}>Telegram User ID</th>
        </tr>
      </thead>
      <tbody>
        {members.map((m) => (
          <tr key={m.pageId}>
            <td style={{ padding: "6px 8px" }}>{m.tradingView}</td>
            <td style={{ padding: "6px 8px" }}>{m.telegramUsername || "-"}</td>
            <td style={{ padding: "6px 8px" }}>{m.telegramUserId || "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
