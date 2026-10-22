import { pageKey } from "./config";
import type { Binding, Decision, Member, Tier } from "./types";
function date(value: string | null): number | null {
  if (!value) return null;
  // Preserve the TG bot's Date.parse semantics, including date-only values.
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
export function evaluateMember(member: Member, now: number, previous?: Binding | null, overrides: Record<string, "trial" | "paid"> = {}, incompletePolicy: "trial" | "review" = "trial"): Decision {
  const status = member.status.trim().toLowerCase();
  if (member.archived || !status || ["expire", "expired", "kick", "kicked", "deny", "denied"].includes(status)) return { state: "deny", reason: "blocked" };
  if (status === "partner") return { state: "allow", tier: "partner", dueAt: null };
  if (["exempt", "vip"].includes(status)) return { state: "allow", tier: "non_expiring", dueAt: null };
  const due = date(member.dueAt);
  if (member.dueAt && due === null) return { state: "review", reason: "invalid_date" };
  if (due !== null && due <= now) return { state: "deny", reason: "expired" };
  if (due === null && incompletePolicy === "review") return { state: "review", reason: "invalid_date" };
  // Only existing Notion records can reach this point. Never create a trial or change its date.
  if (status === "trial_active") return { state: "allow", tier: "trial", dueAt: member.dueAt };
  // Explicit server mapping: eligible and active_paid receive the formal member role.
  if (["active_paid", "eligible"].includes(status)) return { state: "allow", tier: "paid", dueAt: member.dueAt };
  if (status === "join_pending" && due !== null && date(member.paidAt) !== null && date(member.paidAt)! <= now) return { state: "allow", tier: "paid", dueAt: member.dueAt };
  const explicit = overrides[pageKey(member.pageId)];
  if (explicit && due !== null) return { state: "allow", tier: explicit, dueAt: member.dueAt };
  if (previous && previous.pageId === member.pageId && (previous.tier === "trial" || previous.tier === "paid") && previous.dueAt === member.dueAt && previous.paidAt === member.paidAt && due !== null) {
    return { state: "allow", tier: previous.tier, dueAt: member.dueAt };
  }
  // Requested blacklist policy: other non-empty, non-expired membership states may verify.
  // A historical payment alone cannot upgrade an ambiguous membership to paid.
  return incompletePolicy === "trial" ? { state: "allow", tier: "trial", dueAt: member.dueAt } : { state: "review", reason: "ambiguous_tier" };
}
export function normalizeExchangeId(input: string): string { return input.trim().toLowerCase(); }
export function normalizeEmail(input: string): string { return input.trim().toLowerCase(); }
export function validEmail(input: string): boolean { return input.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input); }
export function roleLabel(tier: Tier): string {
  return tier === "trial" ? "探索者" : tier === "partner" ? "飛行員" : "宇航員";
}
export function decisionMessage(decision: Decision): string {
  if (decision.state === "review") return "你的帳號已完成會員資料配對，但目前會籍資料需要助理確認。請聯絡助理；確認後可點「更新身分組」。";
  if (decision.state === "deny") return decision.reason === "expired"
    ? "你的會籍已到期，目前可繼續使用免費資源。若已續費，請待助理更新會籍後再點「更新身分組」。"
    : "目前的會籍狀態無法開通會員身分組，請聯絡助理確認。免費資源仍可正常使用。";
  const label = roleLabel(decision.tier);
  const term = decision.dueAt ? `有效期限：${new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(date(decision.dueAt)!)}。` : ["non_expiring", "partner"].includes(decision.tier) ? "你的會籍不受續費期限限制。" : "目前會員資料尚未設定到期日，之後依共同會籍更新。";
  return `驗證完成，已同步「${label}」身分組。${term} TG 與 Discord 共用同一份會籍。`;
}
