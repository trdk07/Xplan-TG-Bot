import Link from "next/link";
import { LogOut, Users } from "lucide-react";
import { logoutAction } from "@/app/admin/actions";
import { AdminToolPanels } from "@/app/admin/components/AdminToolPanels";
import { MemberSearchForm } from "@/app/admin/components/MemberSearchForm";
import { MembersList } from "@/app/admin/components/MembersList";
import { SettingsPanel } from "@/app/admin/components/SettingsPanel";
import { StatsOverview } from "@/app/admin/components/StatsOverview";
import { ActionButton } from "@/app/components/ActionButton";
import { ActionToast } from "@/app/components/ActionToast";
import { getDisplayConfig, getMissingConfig } from "@/lib/config";
import {
  isPaymentFollowupCandidate,
  isPaymentReviewReady,
  isRenewalNoticeCandidate,
} from "@/lib/member-state";
import { listMembers, type Member } from "@/lib/notion";
import { type MemberStatus, memberStatuses } from "@/lib/status";
import { requireAdmin } from "@/lib/auth";

function scalar(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    status?: string | string[];
    resent?: string | string[];
    inactive?: string | string[];
  }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const q = scalar(params.q);
  const rawStatus = scalar(params.status);
  const resentCount = scalar(params.resent);
  const inactive = scalar(params.inactive);
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
    loadError =
      error instanceof Error ? error.message : "Unable to load members";
  }

  const displayMembers =
    inactive === "show"
      ? members
      : members.filter(
          (m) => !["expired", "kicked", "denied"].includes(m.status),
        );
  const hiddenCount = members.length - displayMembers.length;

  const paymentProofReady = members.filter(
    (member) => isPaymentReviewReady(member),
  ).length;
  const renewalWaiting = members.filter(
    (member) => member.status === "renewal_due",
  ).length;

  const now = new Date();
  const renewalNoticeTargets = members.filter((member) =>
    isRenewalNoticeCandidate(member, now, {
      allowAlreadyReminded: true,
    }),
  ).length;
  const paymentFollowupTargets = members.filter((member) =>
    isPaymentFollowupCandidate(member, now),
  ).length;
  const endingSoon = renewalNoticeTargets + paymentFollowupTargets;
  const paidMembersCount = members.filter((m) => m.paidAt).length;
  const totalRevenue = members.reduce((sum, m) => {
    if (!m.paidAt) return sum;
    if (m.subscriptionMonths === 1) return sum + 50;
    if (m.subscriptionMonths === 3) return sum + 100;
    return sum;
  }, 0);
  const invitationEmailTargets = members.filter(
    (member) =>
      member.status === "eligible" &&
      member.email &&
      !member.invitationEmailSent,
  );
  const invitationEmailList = invitationEmailTargets
    .map((member) => member.email)
    .join("\n");

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

      <StatsOverview
        members={members}
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
          <span className="subtle">{loadError || "Synced from Notion"}</span>
        </div>

        <MemberSearchForm q={q} status={status} />

        <MembersList
          members={members}
          displayMembers={displayMembers}
          hiddenCount={hiddenCount}
          inactive={inactive}
          q={q}
          status={status}
        />
      </section>

    </main>
  );
}
