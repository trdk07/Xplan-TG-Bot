"use client";

import { useMemo, useState } from "react";
import { batchMarkEligibleAction } from "@/app/admin/actions";

type ReviewMember = {
  pageId: string;
  telegramUserId: string;
  telegramUsername: string;
  email: string;
  status: string;
  exchangeName: string;
  exchangeUid: string;
  invitationEmailSent: boolean;
};

type ParsedCsv = {
  uids: string[];
  duplicates: string[];
};

function normalizeUid(value: string) {
  return value.trim().toLowerCase();
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function looksLikeUid(value: string) {
  const normalized = normalizeUid(value);
  return /^[a-z0-9_-]{4,}$/.test(normalized);
}

function parseMexcCsv(text: string): ParsedCsv {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);

  if (!rows.length) return { uids: [], duplicates: [] };

  const header = rows[0].map((cell) => normalizeUid(cell));
  const uidColumn = header.findIndex(
    (cell) => cell.includes("uid") || cell.includes("user id") || cell.includes("用戶"),
  );
  const dataRows = uidColumn >= 0 ? rows.slice(1) : rows;
  const counts = new Map<string, number>();

  for (const row of dataRows) {
    const candidates = uidColumn >= 0 ? [row[uidColumn] || ""] : row;
    const uid = candidates.map(normalizeUid).find(looksLikeUid);
    if (!uid) continue;
    counts.set(uid, (counts.get(uid) || 0) + 1);
  }

  return {
    uids: [...counts.keys()],
    duplicates: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([uid]) => uid),
  };
}

function isReviewCandidate(member: ReviewMember) {
  return ["eligible", "collecting_info", "invite_sent", "denied"].includes(
    member.status,
  );
}

export function MexcCsvMatcher({ members }: { members: ReviewMember[] }) {
  const [csvText, setCsvText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const parsed = useMemo(() => parseMexcCsv(csvText), [csvText]);
  const uidSet = useMemo(() => new Set(parsed.uids), [parsed.uids]);
  const membersByUid = useMemo(() => {
    const map = new Map<string, ReviewMember[]>();
    for (const member of members) {
      const uid = normalizeUid(member.exchangeUid);
      if (!uid) continue;
      map.set(uid, [...(map.get(uid) || []), member]);
    }
    return map;
  }, [members]);

  const matchedMembers = members.filter((member) =>
    uidSet.has(normalizeUid(member.exchangeUid)),
  );
  const approvableMatches = matchedMembers.filter(isReviewCandidate);
  const missingFromMexc = members.filter(
    (member) =>
      isReviewCandidate(member) &&
      member.exchangeUid &&
      !uidSet.has(normalizeUid(member.exchangeUid)),
  );
  const mexcOnlyUids = parsed.uids.filter((uid) => !membersByUid.has(uid));

  function toggle(pageId: string) {
    setSelected((current) =>
      current.includes(pageId)
        ? current.filter((item) => item !== pageId)
        : [...current, pageId],
    );
  }

  function selectAllMatches() {
    setSelected(approvableMatches.map((member) => member.pageId));
  }

  return (
    <div className="stack loose-stack">
      <div className="field">
        <label htmlFor="mexcCsv">貼上 MEXC 下載的 CSV 內容</label>
        <textarea
          className="input csv-input"
          id="mexcCsv"
          onChange={(event) => setCsvText(event.target.value)}
          placeholder="貼上 MEXC 後台匯出的 CSV；若有 UID 欄位會優先使用，否則會自動掃描每列像 UID 的欄位。"
          value={csvText}
        />
      </div>

      <section className="grid stats compact-stats">
        <div className="stat">
          <span className="subtle">CSV UID</span>
          <strong>{parsed.uids.length}</strong>
        </div>
        <div className="stat stat-emphasis">
          <span className="subtle">已匹配</span>
          <strong>{matchedMembers.length}</strong>
        </div>
        <div className="stat">
          <span className="subtle">可批次核准</span>
          <strong>{approvableMatches.length}</strong>
        </div>
        <div className="stat">
          <span className="subtle">MEXC 找不到</span>
          <strong>{missingFromMexc.length}</strong>
        </div>
      </section>

      <div className="action-row wrap-row">
        <button className="button secondary" onClick={selectAllMatches} type="button">
          全選可核准匹配
        </button>
        <form action={batchMarkEligibleAction}>
          <input name="pageIds" type="hidden" value={JSON.stringify(selected)} />
          <button className="button" disabled={!selected.length} type="submit">
            批次標記可入群（{selected.length}）
          </button>
        </form>
      </div>

      <section className="panel nested-panel">
        <div className="panel-head">
          <h3>已匹配 Notion / MEXC</h3>
          <span className="subtle">勾選後可批次改為可入群</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>選取</th>
                <th>Email</th>
                <th>Telegram</th>
                <th>Exchange</th>
                <th>UID</th>
                <th>Status</th>
                <th>邀請 Email</th>
              </tr>
            </thead>
            <tbody>
              {matchedMembers.map((member) => (
                <tr key={member.pageId}>
                  <td>
                    <input
                      checked={selected.includes(member.pageId)}
                      disabled={!isReviewCandidate(member)}
                      onChange={() => toggle(member.pageId)}
                      type="checkbox"
                    />
                  </td>
                  <td>{member.email || "-"}</td>
                  <td>
                    <strong>{member.telegramUserId || "-"}</strong>
                    <div className="subtle">{member.telegramUsername || "-"}</div>
                  </td>
                  <td>{member.exchangeName || "-"}</td>
                  <td>{member.exchangeUid || "-"}</td>
                  <td>{member.status}</td>
                  <td>{member.invitationEmailSent ? "已送出" : "未送出"}</td>
                </tr>
              ))}
              {!matchedMembers.length ? (
                <tr>
                  <td className="subtle" colSpan={7}>
                    尚未找到匹配資料。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid two-col-grid">
        <div className="panel nested-panel">
          <div className="panel-head">
            <h3>Notion 有、MEXC CSV 找不到</h3>
            <span className="subtle">建議人工確認</span>
          </div>
          <div className="stack">
            {missingFromMexc.slice(0, 80).map((member) => (
              <div className="review-card" key={member.pageId}>
                <strong>{member.email || member.telegramUsername || member.pageId}</strong>
                <span className="subtle">UID：{member.exchangeUid || "-"}</span>
              </div>
            ))}
            {!missingFromMexc.length ? <span className="subtle">無</span> : null}
          </div>
        </div>

        <div className="panel nested-panel">
          <div className="panel-head">
            <h3>MEXC CSV 有、Notion 找不到</h3>
            <span className="subtle">可能是未填表或 UID 欄位不同</span>
          </div>
          <div className="stack">
            {mexcOnlyUids.slice(0, 80).map((uid) => (
              <code className="uid-chip" key={uid}>{uid}</code>
            ))}
            {!mexcOnlyUids.length ? <span className="subtle">無</span> : null}
          </div>
        </div>
      </section>

      {parsed.duplicates.length ? (
        <div className="notice warning">
          CSV 內有重複 UID：{parsed.duplicates.join(", ")}
        </div>
      ) : null}
    </div>
  );
}
