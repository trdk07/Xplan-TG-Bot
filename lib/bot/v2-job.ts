import {
  getEvidenceStore,
  type EvidenceStore,
  type MembershipTransition,
} from "@/lib/evidence-store";
import { ExchangeClient } from "@/lib/exchanges";
import {
  getMemberByPageId,
  listMembers,
  updateMember,
  type Member,
} from "@/lib/notion";
import { checkQualifications } from "@/lib/qualification";
import {
  currentPaidFacts,
  effectiveMembership,
  normalizeExchange,
  migrationPreview,
} from "@/lib/membership-v2";
import { hasSubmittedPaymentProof } from "@/lib/bot/handlers/payment";
import { sendMessage } from "@/lib/telegram";
import { renewalKeyboard, rejoinKeyboard } from "@/lib/bot/keyboards";
import { daysUntil, formatDateTime } from "@/lib/dates";

type Guard = () => Promise<void>;
type Delivery = {
  store: Pick<EvidenceStore, "deliverOnce" | "withQualificationLock">;
  read: typeof getMemberByPageId;
  write: typeof updateMember;
  send: typeof sendMessage;
};
type JobDependencies = Omit<Delivery, "store"> & {
  list: typeof listMembers;
  client: Pick<ExchangeClient, "admission" | "volume">;
  store: EvidenceStore;
};
async function delivery(): Promise<Delivery> {
  return {
    store: await getEvidenceStore(),
    read: getMemberByPageId,
    write: updateMember,
    send: sendMessage,
  };
}
const normal = (member: Member) =>
  ["free", "active_volume", "active_paid"].includes(member.status);
const inactiveOrSpecial = (member: Member) =>
  ["suspended", "kicked", "denied", "partner", "exempt", "VIP"].includes(
    member.status,
  );
const timestamp = (value: string | null | undefined) =>
  value ? Date.parse(value) : NaN;
const sameDate = (a: string | null | undefined, b: string | null | undefined) =>
  Number.isFinite(timestamp(a)) && timestamp(a) === timestamp(b);
function expiredPaidCutoff(member: Member, now: Date): string | null {
  const paid = timestamp(member.paidAt),
    due = timestamp(member.reviewDueAt);
  return normal(member) &&
    Number.isFinite(paid) &&
    paid < due &&
    due <= now.getTime()
    ? member.reviewDueAt
    : null;
}

/** Caller owns the page lease; public/manual callers use the wrapper below. */
async function sendReminderUnlocked(
  member: Member,
  now: Date,
  stage: "7day" | "3day",
  d: Delivery,
  guard: Guard,
) {
  const due = member.reviewDueAt,
    days = daysUntil(due, now);
  if (
    !member.telegramUserId ||
    !due ||
    effectiveMembership(member, now) !== "active_paid" ||
    hasSubmittedPaymentProof(member) ||
    days === null ||
    days < 1 ||
    (stage === "3day" ? days > 3 : days < 4 || days > 7)
  )
    return;
  if (member.reminderFieldsAvailable === false)
    throw new Error("Notion reminder fields missing");
  const same = sameDate(member.renewalReminderDueAt, due);
  const marked =
    stage === "3day"
      ? member.renewalReminder3DaySentAt
      : member.renewalReminderSentAt || member.renewalReminder3DaySentAt;
  if (same && marked) return;
  await guard();
  const result = await d.store.deliverOnce(
    `reminder:${member.pageId}:${Date.parse(due)}:${stage}`,
    async () => {
      await guard();
      return d.send(
        member.telegramUserId,
        `你的付費會員資格將在${stage === "7day" ? 7 : 3}天內到期。\n付費截止：${formatDateTime(due)}\n到期後將依交易量轉為交易量會員或免費會員，捉妖小道的付費權限停止。Telegram 群組及 Discord 免費資源會保留。`,
        renewalKeyboard(due),
      );
    },
  );
  if (result === "held") throw new Error("通知傳送結果不明，需要人工覆核");
  await guard();
  await d.write(member.pageId, {
    renewalReminderDueAt: due,
    renewalReminderSentAt:
      stage === "7day"
        ? now.toISOString()
        : same
          ? member.renewalReminderSentAt
          : null,
    renewalReminder3DaySentAt:
      stage === "3day"
        ? now.toISOString()
        : same
          ? member.renewalReminder3DaySentAt
          : null,
    lastBotCheckAt: now.toISOString(),
    lastBotMessage: `${stage} paid expiry reminder delivered`,
  });
}

export async function sendV2RenewalReminder(
  member: Member,
  now: Date,
  stage: "7day" | "3day",
  deps?: Delivery,
) {
  const d = deps || (await delivery());
  return d.store.withQualificationLock(member.pageId, async (guard) => {
    const fresh = await d.read(member.pageId);
    // A bulk/manual list snapshot cannot select a superseded payment cycle.
    if (!fresh || !sameDate(fresh.reviewDueAt, member.reviewDueAt)) return;
    await sendReminderUnlocked(fresh, now, stage, d, guard);
  });
}

async function ensureExpiryIntent(
  member: Member,
  now: Date,
  d: JobDependencies,
  guard: Guard,
) {
  const due = expiredPaidCutoff(member, now),
    tier = effectiveMembership(member, now);
  if (!due || (tier !== "free" && tier !== "active_volume")) return;
  await guard();
  await d.store.recordTransition({
    key: `paid_expiry:${member.pageId}:${Date.parse(due)}`,
    pageId: member.pageId,
    fromTier: "active_paid",
    toTier: tier,
    windowEnd: due,
    kind: "paid_expiry",
  });
}

type IntentState = "ready" | "obsolete" | "pending";
function transitionState(
  event: MembershipTransition,
  member: Member,
  now: Date,
): IntentState {
  if (inactiveOrSpecial(member)) return "obsolete";
  if (!normal(member)) return "pending";
  const tier = effectiveMembership(member, now),
    end = timestamp(event.windowEnd);
  if (event.kind === "paid_expiry") {
    if (!Number.isFinite(end) || !sameDate(member.reviewDueAt, event.windowEnd))
      return "obsolete";
    if (end > now.getTime()) return "pending";
    return expiredPaidCutoff(member, now) && tier === event.toTier
      ? "ready"
      : "obsolete";
  }
  const currentEnd = timestamp(member.volumeWindowEnd),
    checked = timestamp(member.volumeCheckedAt),
    admitted = timestamp(member.admissionVerifiedAt);
  if (!Number.isFinite(end)) return "obsolete";
  // An intent precedes the Notion update. An older/missing successful window is
  // not confirmation and must remain pending after a failed materialization.
  if (
    !Number.isFinite(currentEnd) ||
    currentEnd < end ||
    currentEnd > now.getTime() ||
    !Number.isFinite(checked) ||
    checked < currentEnd ||
    checked > now.getTime() ||
    !Number.isFinite(admitted) ||
    admitted > now.getTime()
  )
    return "pending";
  if (currentEnd > end || tier !== event.toTier) return "obsolete";
  return (
    event.kind === "volume_upgrade"
      ? member.volumeQualified === true
      : member.volumeQualified === false
  )
    ? "ready"
    : "obsolete";
}
async function consumeTransitions(
  member: Member,
  now: Date,
  d: JobDependencies,
  guard: Guard,
) {
  const pending = await d.store.pendingTransitions(member.pageId);
  pending.sort(
    (a, b) =>
      Number(b.kind === "paid_expiry") - Number(a.kind === "paid_expiry"),
  );
  // Consume redundant volume intents first. Otherwise a crash after completing
  // the expiry intent could lose the fact that its volume notice was redundant.
  const redundant = new Set<string>();
  if (
    member.telegramUserId &&
    pending.some(
      (event) =>
        event.kind === "paid_expiry" &&
        transitionState(event, member, now) === "ready",
    )
  ) {
    for (const event of pending) {
      if (
        event.kind !== "paid_expiry" &&
        transitionState(event, member, now) === "ready"
      ) {
        await guard();
        await d.store.completeTransition(event.key);
        redundant.add(event.key);
      }
    }
  }
  for (const event of pending) {
    if (redundant.has(event.key)) continue;
    const state = transitionState(event, member, now);
    if (state === "pending") continue;
    if (state === "obsolete") {
      await guard();
      await d.store.completeTransition(event.key);
      continue;
    }
    if (!member.telegramUserId) continue;
    const content =
      event.kind === "paid_expiry"
        ? `你的付費會員資格已到期。${event.toTier === "active_volume" ? "目前已轉為交易量會員，Discord 保留宇航員。" : "目前回到免費會員，Discord 保留探索者。"}\n捉妖小道的付費權限已停止；Telegram 群組會保留。若需續費，請提交付款資料供助理審核。`
        : event.kind === "volume_upgrade"
          ? "綁定帳號前30個完整日的現貨＋合約交易量已達標200,000 USDT，已升級為交易量會員，Discord 可取得宇航員。Telegram 群組會保留；捉妖小道付費權限仍依有效付費或特殊資格開通。"
          : "綁定帳號前30個完整日的現貨＋合約交易量未達200,000 USDT，目前已回到免費會員與探索者。Telegram 群組會保留；達標後會自動升級，也可申請付費會員。";
    await guard();
    const result = await d.store.deliverOnce(event.key, async () => {
      await guard();
      return d.send(member.telegramUserId, content, rejoinKeyboard());
    });
    if (result === "held") throw new Error("通知傳送結果不明，需要人工覆核");
    await guard();
    await d.store.completeTransition(event.key);
  }
}

/** Reconcile only from a fresh snapshot while holding the same lease as scans/admin writers. */
async function reconcileMember(pageId: string, now: Date, d: JobDependencies) {
  return d.store.withQualificationLock(pageId, async (guard) => {
    let member = await d.read(pageId);
    if (!member) throw new Error("Member not found");
    if (member.qualificationFieldsAvailable === false)
      throw new Error("Notion v2 fields missing");
    if (inactiveOrSpecial(member)) {
      await consumeTransitions(member, now, d, guard);
      return;
    }
    if (!normal(member) || migrationPreview(member, now).needsReview)
      throw new Error("Legacy membership requires migration review");
    // Also backfill expiry intent for unsupported-account/error fallback paths.
    // It is durable before any corresponding status materialization.
    await ensureExpiryIntent(member, now, d, guard);
    const tier = effectiveMembership(member, now);
    if (member.status !== tier) {
      await guard();
      await d.write(pageId, { status: tier });
      member = { ...member, status: tier };
    }

    if (
      member.renewalStep === "payment_pending" &&
      Number.isFinite(timestamp(member.paymentDeadlineAt)) &&
      timestamp(member.paymentDeadlineAt) <= now.getTime() &&
      !hasSubmittedPaymentProof(member)
    ) {
      await guard();
      await d.write(pageId, { renewalStep: "payment_expired" });
      member = { ...member, renewalStep: "payment_expired" };
    }
    await consumeTransitions(member, now, d, guard);
    if (currentPaidFacts(member, now)) {
      const days = daysUntil(member.reviewDueAt, now);
      if (days !== null && days >= 1 && days <= 7)
        await sendReminderUnlocked(
          member,
          now,
          days <= 3 ? "3day" : "7day",
          d,
          guard,
        );
    }
  });
}

export async function runDailyV2(now = new Date(), override?: JobDependencies) {
  const deps: JobDependencies = override || {
    store: await getEvidenceStore(),
    write: updateMember,
    send: sendMessage,
    list: listMembers,
    read: getMemberByPageId,
    client: new ExchangeClient(process.env, fetch, now),
  };
  const members = await deps.list(),
    results: Array<{ pageId: string; action: string; detail?: string }> = [];
  const accounts = new Map<string, number>();
  for (const member of members) {
    const exchange = normalizeExchange(member.exchangeName);
    if (exchange && member.exchangeUid) {
      const key = `${exchange}:${member.exchangeUid}`;
      accounts.set(key, (accounts.get(key) || 0) + 1);
    }
  }
  for (const original of members) {
    try {
      const key = `${normalizeExchange(original.exchangeName)}:${original.exchangeUid}`;
      if ((accounts.get(key) || 0) > 1)
        throw new Error("Duplicate bound account requires review");
      let qualificationIssue: string | undefined;
      try {
        const checked = await checkQualifications(original.pageId, deps, now);
        const expectedGates = new Set([
          "admission_disabled",
          "volume_disabled",
          "volume_not_verified",
          "full_turnover_unavailable",
        ]);
        if (
          checked.qualificationCheckedAt === now.toISOString() &&
          checked.volumeCheckError &&
          !expectedGates.has(checked.volumeCheckError)
        ) {
          qualificationIssue = `Volume verification: ${checked.volumeCheckError}; retained last successful evidence`;
        } else if (
          checked.qualificationCheckedAt === now.toISOString() &&
          !checked.admissionVerifiedAt &&
          checked.onboardingStep === "needs_review" &&
          checked.depositReviewReason &&
          !expectedGates.has(checked.depositReviewReason)
        ) {
          qualificationIssue = `Admission verification requires operator review: ${checked.depositReviewReason}`;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          ["qualification_in_progress", "qualification_lease_expired"].includes(
            error.message,
          )
        ) {
          results.push({
            pageId: original.pageId,
            action: "qualification_busy",
          });
          continue;
        }
        qualificationIssue = "Qualification requires operator review";
      }
      await reconcileMember(original.pageId, now, deps);
      results.push({
        pageId: original.pageId,
        action: qualificationIssue ? "error" : "qualification_checked",
        ...(qualificationIssue ? { detail: qualificationIssue } : {}),
      });
    } catch (error) {
      results.push({
        pageId: original.pageId,
        action: "error",
        detail:
          error instanceof Error ? error.message : "Membership check failed",
      });
    }
  }
  return results;
}
