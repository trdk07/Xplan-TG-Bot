import Link from "next/link";
import type { Route } from "next";
import { LogOut, Users } from "lucide-react";
import { logoutAction } from "@/app/admin/actions";
import { AdminToolPanels } from "@/app/admin/components/AdminToolPanels";
import { MemberSearchForm } from "@/app/admin/components/MemberSearchForm";
import { MembersList } from "@/app/admin/components/MembersList";
import { SettingsPanel } from "@/app/admin/components/SettingsPanel";
import { StatsOverview } from "@/app/admin/components/StatsOverview";
import { TodayInbox } from "@/app/admin/components/TodayInbox";
import { ActionButton } from "@/app/components/ActionButton";
import { ActionToast } from "@/app/components/ActionToast";
import { isAdminView, isInvitationPending, matchesAdminView } from "@/lib/admin-views";
import { getDisplayConfig, getMissingConfig } from "@/lib/config";
import {
  isPaymentFollowupCandidate,
  isPaymentReviewReady,
  isRenewalNoticeCandidate,
} from "@/lib/member-state";
import { listMembers, memberMatchesQuery, type Member } from "@/lib/notion";
import { type MemberStatus, memberStatuses } from "@/lib/status";
import { getAdminOperator, requireAdmin } from "@/lib/auth";

function scalar(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    status?: string | string[];
    view?: string | string[];
    resent?: string | string[];
    inactive?: string | string[];
    density?: string | string[];
  }>;
}) {
  await requireAdmin();
  const operator = await getAdminOperator();
  const params = await searchParams;
  const q = scalar(params.q);
  const rawStatus = scalar(params.status);
  const rawView = scalar(params.view);
  const resentCount = scalar(params.resent);
  const inactive = scalar(params.inactive);
  const density = scalar(params.density) === "full" ? "full" : "compact";
  const status = memberStatuses.includes(rawStatus as MemberStatus)
    ? (rawStatus as MemberStatus)
    : "all";
  const view = isAdminView(rawView) ? rawView : null;
  const config = getDisplayConfig();
  const missingConfig = getMissingConfig();

  // allMembers is the unfiltered source of truth for every stat card and
  // the Inbox — it never changes based on the current search/status/view,
  // so the numbers on screen always match what a filtered click-through shows.
  let allMembers: Member[] = [];
  let loadError = "";
  try {
    allMembers = await listMembers({ limit: 500 });
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Unable to load members";
  }

  const now = new Date();

  const queryFiltered = q
    ? allMembers.filter((member) => memberMatchesQuery(member, q))
    : allMembers;
  const listedMembers = view
    ? queryFiltered.filter((member) => matchesAdminView(member, view, now))
    : status !== "all"
      ? queryFiltered.filter((member) => member.status === status)
      : queryFiltered;

  const displayMembers =
    inactive === "show"
      ? listedMembers
      : listedMembers.filter(
          (m) => !["expired", "kicked", "denied"].includes(m.status),
        );
  const hiddenCount = listedMembers.length - displayMembers.length;

  const paymentProofReady = allMembers.filter((member) =>
    isPaymentReviewReady(member),
  ).length;
  const renewalWaiting = allMembers.filter(
    (member) => member.status === "renewal_due",
  ).length;

  const renewalNoticeTargets = allMembers.filter((member) =>
    isRenewalNoticeCandidate(member, now, {
      allowAlreadyReminded: true,
    }),
  ).length;
  const paymentFollowupTargets = allMembers.filter((member) =>
    isPaymentFollowupCandidate(member, now),
  ).length;
  const endingSoon = renewalNoticeTargets + paymentFollowupTargets;
  const paidMembersCount = allMembers.filter((m) => m.paidAt).length;
  const totalRevenue = allMembers.reduce((sum, m) => {
    if (!m.paidAt) return sum;
    if (m.subscriptionMonths === 1) return sum + 50;
    if (m.subscriptionMonths === 3) return sum + 100;
    return sum;
  }, 0);
  const invitationEmailTargets = allMembers.filter((member) =>
    isInvitationPending(member),
  );
  const invitationEmailList = invitationEmailTargets
    .map((member) => member.email)
    .join("\n");

  const filterParam = view ? `view=${view}` : `status=${status}`;
  const densityToggleHref = `/admin?q=${encodeURIComponent(q)}&${filterParam}${
    inactive === "show" ? "&inactive=show" : ""
  }&density=${density === "full" ? "compact" : "full"}`;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Telegram 會員入群 Bot</h1>
          <p className="subtle">
            Notion-only membership gate and renewal dashboard.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="subtle">操作人：{operator}</span>
          <Link className="button secondary" href="/admin/revenue">
            收入報表
          </Link>
          <Link className="button secondary" href="/admin/tradingview">
            TradingView 名單
          </Link>
          <form action={logoutAction}>
            <ActionButton icon={<LogOut />} secondary>
              登出
            </ActionButton>
          </form>
        </div>
      </header>

      <TodayInbox members={allMembers} />

      <StatsOverview
        members={allMembers}
        paymentProofReady={paymentProofReady}
        renewalWaiting={renewalWaiting}
        endingSoon={endingSoon}
        invitationEmailCount={invitationEmailTargets.length}
        totalRevenue={totalRevenue}
        paidMembersCount={paidMembersCount}
      />

      {resentCount ? (
        <ActionToast
          message={`已重新發送最新版續約通知給 ${resentCount} 位 0～7 天內到期的會員。`}
        />
      ) : null}

      <AdminToolPanels
        endingSoon={endingSoon}
        invitationEmailCount={invitationEmailTargets.length}
        invitationEmailList={invitationEmailList}
      />

      <SettingsPanel config={config} missingConfig={missingConfig} />

      <section className="panel">
        <div className="panel-head">
          <h2>
            <Users width={16} height={16} aria-hidden="true" /> Members
          </h2>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Link className="subtle small-text" href={densityToggleHref as Route}>
              {density === "full" ? "精簡檢視" : "完整檢視"}
            </Link>
            <span className="subtle">{loadError || "Synced from Notion"}</span>
          </div>
        </div>

        <MemberSearchForm q={q} status={status} />

        <MembersList
          members={listedMembers}
          displayMembers={displayMembers}
          hiddenCount={hiddenCount}
          inactive={inactive}
          q={q}
          filterParam={filterParam}
          density={density}
        />
      </section>

    </main>
  );
}
