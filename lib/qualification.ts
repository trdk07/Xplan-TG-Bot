import { ExchangeClient, ExchangeCheckError } from "@/lib/exchanges";
import { getEvidenceStore, type EvidenceStore } from "@/lib/evidence-store";
import {
  admissionDecision,
  amountAtLeast,
  completedVolumeWindow,
  effectiveMembership,
  migrationPreview,
  normalizeExchange,
  sumAmounts,
  volumeMeetsThreshold,
  v2Statuses,
  type Exchange,
} from "@/lib/membership-v2";
import {
  getMemberByPageId,
  listMembers,
  updateMember,
  type Member,
  type MemberPatch,
} from "@/lib/notion";

type Dependencies = {
  read: typeof getMemberByPageId;
  list: typeof listMembers;
  write: typeof updateMember;
  store: Pick<
    EvidenceStore,
    | "recordDeposits"
    | "depositTotal"
    | "withQualificationLock"
    | "reserveAccount"
    | "recordTransition"
  >;
  client: Pick<ExchangeClient, "admission" | "volume">;
};
export function qualificationError(error: unknown) {
  return error instanceof ExchangeCheckError
    ? error.message
    : "upstream_unavailable";
}
/** Re-read the same account after upstream I/O. Never overwrite payment or Discord facts. */
export async function checkQualifications(
  pageId: string,
  deps: Dependencies,
  now = new Date(),
  admissionOnly = false,
): Promise<Member> {
  return deps.store.withQualificationLock(pageId, (guard) =>
    checkUnlocked(pageId, deps, now, admissionOnly, guard),
  );
}
async function checkUnlocked(
  pageId: string,
  deps: Dependencies,
  now: Date,
  admissionOnly: boolean,
  guard: () => Promise<void>,
): Promise<Member> {
  const member = await deps.read(pageId);
  if (!member) throw new Error("Member not found");
  if (member.qualificationFieldsAvailable === false)
    throw new Error(
      "Notion v2 fields missing; run schema setup before activation",
    );
  if (
    !v2Statuses.includes(member.status as any) &&
    migrationPreview(member, now).needsReview
  )
    throw new Error(
      "Legacy payment evidence requires review before v2 activation",
    );
  if (
    ["suspended", "kicked", "denied", "partner", "exempt", "VIP"].includes(
      member.status,
    )
  )
    return member;
  const exchange = normalizeExchange(member.exchangeName);
  if (!exchange || !member.exchangeUid)
    throw new Error("Account requires exchange/UID review");
  const sameAccounts = (await deps.list()).filter(
    (other) =>
      normalizeExchange(other.exchangeName) === exchange &&
      other.exchangeUid.trim() === member.exchangeUid.trim(),
  );
  const canonical = (value: string) => value.replaceAll("-", "").toLowerCase();
  if (
    sameAccounts.length !== 1 ||
    canonical(sameAccounts[0].pageId) !== canonical(member.pageId)
  )
    throw new Error("duplicate_account_requires_review");
  await deps.store.reserveAccount(pageId, exchange, member.exchangeUid);
  const patch: MemberPatch = { qualificationCheckedAt: now.toISOString() };
  let admitted = Boolean(member.admissionVerifiedAt);
  if (!admitted) {
    try {
      const evidence = await deps.client.admission(
        exchange,
        member.exchangeUid,
      );
      await deps.store.recordDeposits(
        exchange,
        member.exchangeUid,
        evidence.events,
      );
      const ledger = await deps.store.depositTotal(
        exchange,
        member.exchangeUid,
      );
      const proven = amountAtLeast(evidence.cumulative, ledger)
        ? evidence.cumulative
        : ledger;
      sumAmounts([proven]);
      const decision = admissionDecision(
        null,
        evidence.referral,
        proven,
        evidence.complete,
      );
      if (evidence.referral !== null)
        patch.exchangeRegistered = evidence.referral;
      patch.verifiedDepositUsdt = Number(proven);
      patch.depositEvidenceComplete = evidence.complete;
      admitted = decision === "verified";
      patch.onboardingStep = admitted
        ? member.groupJoinedAt
          ? "joined"
          : "eligible"
        : decision === "needs_review"
          ? "needs_review"
          : "collecting_info";
      patch.depositReviewReason = admitted
        ? ""
        : decision === "needs_review"
          ? "歷史入金資料不足，請由助理核對；不是不合格判定。"
          : "推薦關係或已確認的入金金額尚未達入群條件。";
      if (admitted) {
        patch.admissionVerifiedAt = now.toISOString();
        patch.exchangeRegistered = true;
      }
    } catch (error) {
      patch.depositReviewReason = qualificationError(error);
      patch.onboardingStep = "needs_review";
    }
  }
  if (admitted && !admissionOnly) {
    try {
      const window = completedVolumeWindow(now),
        volume = await deps.client.volume(exchange, member.exchangeUid, window);
      patch.volumeSpot30d = Number(volume.spot);
      patch.volumeFutures30d = Number(volume.futures);
      patch.volumeTotal30d = Number(sumAmounts([volume.spot, volume.futures]));
      if (
        ![
          patch.volumeSpot30d,
          patch.volumeFutures30d,
          patch.volumeTotal30d,
        ].every(Number.isFinite)
      )
        throw new ExchangeCheckError("invalid_volume_amount");
      patch.volumeQualified = volumeMeetsThreshold(volume.spot, volume.futures);
      patch.volumeWindowStart = window.start;
      patch.volumeWindowEnd = window.end;
      patch.volumeCheckedAt = now.toISOString();
      patch.volumeCheckError = "";
    } catch (error) {
      // The old flag, last successful date and amounts survive any upstream failure.
      for (const key of [
        "volumeSpot30d",
        "volumeFutures30d",
        "volumeTotal30d",
        "volumeQualified",
        "volumeWindowStart",
        "volumeWindowEnd",
        "volumeCheckedAt",
      ] as const)
        delete patch[key];
      patch.volumeCheckError = qualificationError(error);
    }
  }
  const fresh = await deps.read(pageId);
  if (!fresh) throw new Error("Member not found");
  if (
    normalizeExchange(fresh.exchangeName) !== exchange ||
    fresh.exchangeUid !== member.exchangeUid
  )
    throw new Error("account_changed_during_check");
  if (member.admissionVerifiedAt && !fresh.admissionVerifiedAt)
    throw new Error("admission_reset_during_check");
  if (
    [fresh.qualificationCheckedAt, fresh.volumeCheckedAt].some(
      (value) => value && Date.parse(value) > now.getTime(),
    )
  )
    return fresh;
  if (
    fresh.admissionVerifiedAt &&
    fresh.admissionVerifiedAt !== member.admissionVerifiedAt
  ) {
    for (const key of [
      "admissionVerifiedAt",
      "onboardingStep",
      "depositReviewReason",
      "verifiedDepositUsdt",
      "depositEvidenceComplete",
    ] as const)
      delete patch[key];
  }
  const result = { ...fresh, ...patch };
  patch.status = effectiveMembership(result, now);
  result.status = patch.status;
  const changed = Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) => value !== (fresh as any)[key],
    ),
  ) as MemberPatch;
  await guard();
  if (fresh.status !== patch.status) {
    let kind: "paid_expiry" | "volume_upgrade" | "volume_downgrade" | null =
      null;
    let end: string | null = result.volumeWindowEnd || null;
    const due = fresh.reviewDueAt ? Date.parse(fresh.reviewDueAt) : NaN;
    if (
      fresh.status === "active_paid" &&
      ["active_volume", "free"].includes(patch.status) &&
      fresh.paidAt &&
      Number.isFinite(Date.parse(fresh.paidAt)) &&
      Date.parse(fresh.paidAt) < due &&
      due <= now.getTime()
    ) {
      kind = "paid_expiry";
      end = fresh.reviewDueAt;
    } else if (fresh.status === "free" && patch.status === "active_volume")
      kind = "volume_upgrade";
    else if (fresh.status === "active_volume" && patch.status === "free")
      kind = "volume_downgrade";
    if (kind && end)
      await deps.store.recordTransition({
        key: `${kind}:${fresh.pageId}:${Date.parse(end)}`,
        pageId: fresh.pageId,
        fromTier: fresh.status,
        toTier: patch.status,
        windowEnd: end,
        kind,
      });
  }
  await guard();
  if (Object.keys(changed).length) await deps.write(pageId, changed);
  return result;
}
export async function withQualificationLock<T>(
  pageId: string,
  work: (guard: () => Promise<void>) => Promise<T>,
): Promise<T> {
  return (await getEvidenceStore()).withQualificationLock(pageId, work);
}
export async function reserveBoundAccount(
  pageId: string,
  exchange: Exchange,
  uid: string,
) {
  return (await getEvidenceStore()).reserveAccount(pageId, exchange, uid);
}
export async function recheckQualifications(
  pageId: string,
  now = new Date(),
  admissionOnly = false,
) {
  const store = await getEvidenceStore();
  return checkQualifications(
    pageId,
    {
      read: getMemberByPageId,
      list: listMembers,
      write: updateMember,
      store,
      client: new ExchangeClient(process.env, fetch, now),
    },
    now,
    admissionOnly,
  );
}
