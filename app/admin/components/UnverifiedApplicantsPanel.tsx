import Link from "next/link";
import type { Route } from "next";
import { formatDateTime } from "@/lib/dates";
import type { Member } from "@/lib/notion";
import { normalizeTelegramUsername } from "@/lib/notion";
import {
  UNVERIFIED_AFTER_DAYS,
  unverifiedApplicants,
} from "@/lib/unverified-applicants";

/** Applications that never reached the bot, so the assistant can follow up. */
export function UnverifiedApplicantsPanel({
  members,
  now = new Date(),
}: {
  members: Member[];
  now?: Date;
}) {
  const applicants = unverifiedApplicants(members, now);
  if (!applicants.length) return null;
  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-head">
        <h2>已報名未驗證</h2>
        <span className="subtle">{applicants.length} 位</span>
      </div>
      <div className="panel-body">
        <p className="field-hint">
          填了報名表超過 {UNVERIFIED_AFTER_DAYS} 天，但還沒到 Telegram 機器人按
          /start。系統不會自動刪除，他們之後回來驗證仍然有效；可以聯絡提醒，
          確定不來的再到 Notion 封存。
        </p>
      </div>
      <div className="stack">
        {applicants.map(({ member, days }) => {
          const username = normalizeTelegramUsername(member.telegramUsername);
          return (
            <article key={member.pageId} className="review-card">
              <Link href={`/admin/member/${member.pageId}` as Route}>
                {member.telegramUsername || member.email || "查看申請"}
              </Link>
              <p className="subtle">
                報名 {days} 天・{formatDateTime(member.createdAt ?? null)}・
                {member.exchangeName || "未填交易所"}
              </p>
              <p className="small-text applicant-contacts">
                {username ? (
                  <a href={`https://t.me/${username}`} target="_blank" rel="noreferrer">
                    Telegram @{username}
                  </a>
                ) : null}
                {member.email ? <a href={`mailto:${member.email}`}>{member.email}</a> : null}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
