"use client";
import { useActionState } from "react";
import { RefreshCw, Unlink } from "lucide-react";
import {
  syncDiscordRoleAction,
  unlinkDiscordAction,
} from "@/app/admin/actions";
import { ActionButton } from "@/app/components/ActionButton";
import type { DiscordAdminState } from "@/lib/discord-admin";
const initial: DiscordAdminState = { kind: "idle", message: "" };
export function DiscordAdminControls({
  pageId,
  discordId,
  verifiedAt,
  configured,
}: {
  pageId: string;
  discordId: string;
  verifiedAt: string | null;
  configured: boolean;
}) {
  const [syncState, sync, syncPending] = useActionState(
    syncDiscordRoleAction.bind(null, pageId, discordId, verifiedAt),
    initial,
  );
  const [unlinkState, unlink, unlinkPending] = useActionState(
    unlinkDiscordAction.bind(null, pageId, discordId, verifiedAt),
    initial,
  );
  const disabled = !configured || !discordId || syncPending || unlinkPending;
  return (
    <section className="stack" aria-label="Discord 管理操作">
      <h4>Discord 管理</h4>
      {!configured ? (
        <p className="field-hint">尚未設定 DC 管理連線，請由管理者完成設定。</p>
      ) : !discordId ? (
        <p className="field-hint">目前沒有 DC 綁定，請會員先完成身分驗證。</p>
      ) : null}
      <form action={sync}>
        <ActionButton icon={<RefreshCw />} secondary disabled={disabled}>
          立即同步 DC 角色
        </ActionButton>
        <p className="field-hint">
          依 Notion 最新會員資格同步，不重新查詢交易所。
        </p>
      </form>
      {syncState.message ? (
        <p role={syncState.kind === "error" ? "alert" : "status"}>
          {syncState.message}
        </p>
      ) : null}
      <details className="advanced-actions">
        <summary>解除 DC 綁定</summary>
        <form action={unlink} className="stack">
          <p className="field-hint">
            先撤除本系統管理的會員角色並恢復探索者，再清除 DC 驗證紀錄。保留
            TG、付費與交易量資料，不移出 Discord；會員需重新驗證。
          </p>
          <label>
            <input
              type="checkbox"
              name="confirmUnlink"
              value="yes"
              required
              disabled={disabled}
            />{" "}
            我確認解除此會員目前的 DC 綁定
          </label>
          <ActionButton icon={<Unlink />} danger disabled={disabled}>
            確認解除 DC 綁定
          </ActionButton>
        </form>
      </details>
      {unlinkState.message ? (
        <p role={unlinkState.kind === "error" ? "alert" : "status"}>
          {unlinkState.message}
        </p>
      ) : null}
    </section>
  );
}
