import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { MexcCsvMatcher } from "@/app/admin/applications/MexcCsvMatcher";
import { requireAdmin } from "@/lib/auth";
import { listMembers } from "@/lib/notion";

function scalar(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function ApplicationReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ approved?: string | string[] }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const approved = scalar(params.approved);
  const members = await listMembers({ limit: 1000 });
  const reviewMembers = members.map((member) => ({
    pageId: member.pageId,
    telegramUserId: member.telegramUserId,
    telegramUsername: member.telegramUsername,
    email: member.email,
    status: member.status,
    exchangeName: member.exchangeName,
    exchangeUid: member.exchangeUid,
    invitationEmailSent: member.invitationEmailSent,
  }));

  return (
    <main className="shell wide-shell">
      <header className="topbar">
        <div>
          <h1>MEXC 入群申請比對</h1>
          <p className="subtle">
            貼上 MEXC 後台下載的 CSV，和 Notion/Tally 名單做雙向比對；匹配後可批次標記為可入群。
          </p>
        </div>
        <Link href="/admin" className="button secondary">
          <RefreshCw width={16} height={16} aria-hidden="true" />
          回後台
        </Link>
      </header>

      {approved ? (
        <div className="notice success" role="status">
          已批次標記 {approved} 位會員為可入群。
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>CSV 雙向比對</h2>
          <span className="subtle">Notion 會員：{reviewMembers.length} 位</span>
        </div>
        <div className="panel-body">
          <MexcCsvMatcher members={reviewMembers} />
        </div>
      </section>
    </main>
  );
}
