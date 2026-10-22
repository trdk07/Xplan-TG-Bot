import Link from "next/link";
import { isTrialExperience, matchesAdminView } from "@/lib/admin-views";
import { hasCurrentMembership } from "@/lib/membership-policy";
import { nonExpiringStatuses } from "@/lib/status";
import { requireAdmin } from "@/lib/auth";
import { listMembers, type Member } from "@/lib/notion";

export default async function TradingViewPage() {
  await requireAdmin();

  const members = await listMembers({ limit: 500 });

  const tvMembers = members.filter((m) => m.tradingView);

  const now = new Date();

  const activePaid1Month: Member[] = [];
  const activePaid3Month: Member[] = [];
  const activePaidUnclassified: Member[] = [];
  const trial: Member[] = [];
  const membershipReview: Member[] = [];
  const nonExpiring: Member[] = [];

  for (const m of tvMembers) {
    if (!hasCurrentMembership(m, now)) continue;
    if (nonExpiringStatuses.has(m.status)) {
      nonExpiring.push(m);
    } else if (matchesAdminView(m, "paid_active", now)) {
      if (m.subscriptionMonths === 1) {
        activePaid1Month.push(m);
      } else if (m.subscriptionMonths === 3) {
        activePaid3Month.push(m);
      } else {
        activePaidUnclassified.push(m);
      }
    } else if (isTrialExperience(m, now)) {
      trial.push(m);
    } else {
      membershipReview.push(m);
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

      {nonExpiring.length > 0 ? (
        <section className="panel">
          <div className="panel-head"><h2>免續約會籍</h2><span className="subtle">{nonExpiring.length} 位</span></div>
          <div className="panel-body"><TradingViewList members={nonExpiring} /></div>
        </section>
      ) : null}

      {membershipReview.length > 0 ? (
        <section className="panel">
          <div className="panel-head"><h2>會籍類型待確認</h2><span className="subtle">{membershipReview.length} 位</span></div>
          <div className="panel-body">
            <p className="subtle">會籍尚未到期，保留現有權益；請確認試用或付費類型。</p>
            <TradingViewList members={membershipReview} />
          </div>
        </section>
      ) : null}

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
