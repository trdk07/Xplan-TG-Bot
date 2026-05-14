import Link from "next/link";
import {
  CircleDollarSign,
  Filter,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { logoutAction } from "@/app/admin/actions";
import { StatusBadge } from "@/app/components/StatusBadge";
import { getDisplayConfig, getMissingConfig } from "@/lib/config";
import { daysUntil, formatDateTime } from "@/lib/dates";
import { listMembers, type Member } from "@/lib/notion";
import { memberStatusLabel, memberStatuses, type MemberStatus } from "@/lib/status";
import { requireAdmin } from "@/lib/auth";

function statCount(members: Member[], statuses: MemberStatus[]) {
  return members.filter((member) => statuses.includes(member.status)).length;
}

function scalar(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; status?: string | string[] }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const q = scalar(params.q);
  const rawStatus = scalar(params.status);
  const status = memberStatuses.includes(rawStatus as MemberStatus)
    ? (rawStatus as MemberStatus)
    : "all";
  const config = getDisplayConfig();
  const missingConfig = getMissingConfig();

  let members: Member[] = [];
  let loadError = "";
  try {
    members = await listMembers({ status, query: q, limit: 500 });
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load members";
  }

  const trialEndingSoon = members.filter((member) => {
    const days = daysUntil(member.reviewDueAt);
    return member.status === "trial_active" && days !== null && days <= 7;
  }).length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Telegram 會員入群 Bot</h1>
          <p className="subtle">Notion-only membership gate and renewal dashboard.</p>
        </div>
        <form action={logoutAction}>
          <button className="button secondary" type="submit">
            <LogOut width={16} height={16} aria-hidden="true" />
            登出
          </button>
        </form>
      </header>

      <section className="grid stats">
        <div className="stat">
          <span className="subtle">Loaded Members</span>
          <strong>{members.length}</strong>
        </div>
        <div className="stat">
          <span className="subtle">Active</span>
          <strong>{statCount(members, ["trial_active", "active_paid"])}</strong>
        </div>
        <div className="stat">
          <span className="subtle">Payment Pending</span>
          <strong>{statCount(members, ["payment_pending"])}</strong>
        </div>
        <div className="stat">
          <span className="subtle">Trial Ending Soon</span>
          <strong>{trialEndingSoon}</strong>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <h2>
            <Settings width={16} height={16} aria-hidden="true" /> Settings
          </h2>
          <span className="subtle">
            {missingConfig.length ? `Missing: ${missingConfig.join(", ")}` : "Config OK"}
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

      <section className="panel">
        <div className="panel-head">
          <h2>
            <Users width={16} height={16} aria-hidden="true" /> Members
          </h2>
          <span className="subtle">{loadError || "Synced from Notion"}</span>
        </div>

        <form className="toolbar">
          <div className="field">
            <label htmlFor="q">Search</label>
            <input
              className="input"
              id="q"
              name="q"
              defaultValue={q}
              placeholder="Telegram ID, username, UID..."
            />
          </div>
          <div className="field">
            <label htmlFor="status">Status</label>
            <select className="input" id="status" name="status" defaultValue={status}>
              <option value="all">all</option>
              {memberStatuses.map((item) => (
                <option key={item} value={item}>
                  {memberStatusLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <button className="button" type="submit">
            <Search width={16} height={16} aria-hidden="true" />
            搜尋
          </button>
        </form>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Status</th>
                <th>Exchange</th>
                <th>Exchange UID</th>
                <th>Tags</th>
                <th>Joined</th>
                <th>Review Due</th>
                <th>Payment Deadline</th>
                <th>Last Check</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.pageId}>
                  <td>
                    <strong>{member.telegramUserId || "-"}</strong>
                    <div className="subtle">{member.telegramUsername || "-"}</div>
                  </td>
                  <td>
                    <StatusBadge status={member.status} />
                  </td>
                  <td>{member.exchangeName || "-"}</td>
                  <td>{member.exchangeUid || "-"}</td>
                  <td>{member.tags.length ? member.tags.join(", ") : "-"}</td>
                  <td>{formatDateTime(member.groupJoinedAt)}</td>
                  <td>{formatDateTime(member.reviewDueAt)}</td>
                  <td>{formatDateTime(member.paymentDeadlineAt)}</td>
                  <td>{formatDateTime(member.lastBotCheckAt)}</td>
                  <td>
                    <Link className="button secondary" href={`/admin/member/${member.pageId}`}>
                      <Filter width={16} height={16} aria-hidden="true" />
                      管理
                    </Link>
                  </td>
                </tr>
              ))}
              {!members.length ? (
                <tr>
                  <td colSpan={10} className="subtle">
                    沒有符合條件的會員。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid stats" style={{ marginTop: 20 }}>
        <div className="stat">
          <ShieldCheck width={20} height={20} aria-hidden="true" />
          <span className="subtle">Gate</span>
          <strong>Join Request</strong>
        </div>
        <div className="stat">
          <CircleDollarSign width={20} height={20} aria-hidden="true" />
          <span className="subtle">Payment</span>
          <strong>Pseudocode</strong>
        </div>
      </section>
    </main>
  );
}
