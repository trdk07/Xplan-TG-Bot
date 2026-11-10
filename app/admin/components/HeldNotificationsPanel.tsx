import Link from "next/link";
import type { Route } from "next";
import { Check } from "lucide-react";
import { resolveHeldNotificationAction } from "@/app/admin/actions";
import { ActionButton } from "@/app/components/ActionButton";
import { formatDateTime } from "@/lib/dates";
import {
  notificationKindLabel,
  pageIdFromNotificationKey,
} from "@/lib/evidence-store";
import type { Member } from "@/lib/notion";

export type HeldNotification = { key: string; state: string; created_at: string };

const canonical = (id: string) => id.replaceAll("-", "").toLowerCase();

/** Notifications whose delivery is unknown; the daily job reports them until resolved here. */
export function HeldNotificationsPanel({
  held,
  members,
}: {
  held: HeldNotification[];
  members: Member[];
}) {
  if (!held.length) return null;
  const byId = new Map(members.map((member) => [canonical(member.pageId), member]));
  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head">
        <h2>待確認通知</h2>
        <span className="subtle">{held.length} 則</span>
      </div>
      <p className="field-hint">
        這些通知送出時發生錯誤，系統不確定會員有沒有收到，所以不會自動重送，每日檢查也會一直提醒。
        確認後按「已處理」即可結案（不會重送）；若需要通知會員，請另外私訊。
      </p>
      <div className="stack">
        {held.map((item) => {
          const pageId = pageIdFromNotificationKey(item.key);
          const member = pageId ? byId.get(canonical(pageId)) : undefined;
          const name =
            member?.telegramUsername || member?.email || pageId || "未知會員";
          return (
            <article key={item.key} className="review-card">
              {member ? (
                <Link href={`/admin/member/${member.pageId}` as Route}>{name}</Link>
              ) : (
                <strong>{name}</strong>
              )}
              <p className="subtle">
                {notificationKindLabel(item.key)}・{formatDateTime(item.created_at)}
              </p>
              <form action={resolveHeldNotificationAction.bind(null, item.key)}>
                <ActionButton icon={<Check />} secondary>
                  已處理（不重送）
                </ActionButton>
              </form>
            </article>
          );
        })}
      </div>
    </section>
  );
}
