import { formatDateTime } from "@/lib/dates";
import type { Member } from "@/lib/notion";

type DiscordMember = Pick<Member, "discordId" | "discordVerifiedAt" | "discordRole">;

function verificationRecord(member: DiscordMember) {
  const hasId = Boolean(member.discordId.trim());
  const recordedAt = member.discordVerifiedAt?.trim() || null;
  const validDate = recordedAt && Number.isFinite(Date.parse(recordedAt)) ? recordedAt : null;

  if (hasId && validDate) {
    return { label: "已驗證", tone: "success", validDate };
  }
  if (!hasId && !recordedAt) {
    return { label: "無驗證紀錄", tone: "muted", validDate };
  }
  return { label: "驗證資料不完整", tone: "warning", validDate };
}

export function DiscordSummary({ member }: { member: DiscordMember }) {
  const verification = verificationRecord(member);

  return (
    <span className="discord-summary">
      <span className={`mini-badge ${verification.tone}`}>
        <span className="badge-dot" aria-hidden="true" />
        {verification.label}
      </span>
      <span className="discord-role">
        身分組：{member.discordRole?.trim() || "尚無身分組紀錄"}
      </span>
      <span className="subtle small-text">資料來源：Notion</span>
    </span>
  );
}

export function DiscordDetails({ member }: { member: DiscordMember }) {
  const { validDate } = verificationRecord(member);

  return (
    <>
      <div>Discord 驗證與身分組</div>
      <div><DiscordSummary member={member} /></div>
      <div>Discord ID</div>
      <div className="discord-id">{member.discordId || "-"}</div>
      <div>Discord 驗證時間</div>
      <div>
        {member.discordVerifiedAt?.trim() && !validDate
          ? "日期格式異常"
          : formatDateTime(validDate)}
      </div>
    </>
  );
}
