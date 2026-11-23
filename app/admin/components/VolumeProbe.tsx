"use client";
import { useActionState } from "react";
import { Search } from "lucide-react";
import {
  diagnoseAdmissionAction,
  probeVolumeAction,
} from "@/app/admin/actions";
import { ActionButton } from "@/app/components/ActionButton";
import type { VolumeProbeState } from "@/lib/volume-probe";

const initial: VolumeProbeState = { kind: "idle", message: "", lines: [] };

/** Read-only check of the bound account's 30-day turnover; nothing is saved. */
export function VolumeProbe({ pageId }: { pageId: string }) {
  const [state, probe, pending] = useActionState(
    probeVolumeAction.bind(null, pageId),
    initial,
  );
  return (
    <section className="stack" aria-label="交易量試查">
      <form action={probe}>
        <ActionButton icon={<Search />} secondary disabled={pending}>
          交易量試查（近 30 天）
        </ActionButton>
        <p className="field-hint">
          直接向交易所查詢這位會員綁定帳號的成交額，只顯示結果，不寫入
          Notion、不改變資格；交易量自動查詢未開啟時也能使用。
        </p>
      </form>
      {state.message ? (
        <div
          className={`notice ${state.kind === "error" ? "warning" : ""}`}
          role={state.kind === "error" ? "alert" : "status"}
        >
          <strong>{state.message}</strong>
          {state.lines.length ? (
            <ul className="probe-lines">
              {state.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {state.details ? (
            <details className="probe-details">
              <summary>{state.details.summary}</summary>
              <ul className="probe-lines">
                {state.details.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Read-only view of what the exchange answers for this member's admission check. */
export function AdmissionDiagnosis({ pageId }: { pageId: string }) {
  const [state, diagnose, pending] = useActionState(
    diagnoseAdmissionAction.bind(null, pageId),
    initial,
  );
  return (
    <section className="stack" aria-label="入群查核診斷">
      <form action={diagnose}>
        <ActionButton icon={<Search />} secondary disabled={pending}>
          入群查核診斷
        </ActionButton>
        <p className="field-hint">
          直接向交易所查詢這個 UID 的推薦關係與入金，顯示交易所實際回傳的內容。
          只顯示結果，不寫入 Notion、不改變資格。
        </p>
      </form>
      {state.message ? (
        <div
          className={`notice ${state.kind === "error" ? "warning" : ""}`}
          role={state.kind === "error" ? "alert" : "status"}
        >
          <strong>{state.message}</strong>
          {state.lines.length ? (
            <ul className="probe-lines">
              {state.lines.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
