"use server";

import { randomUUID } from "node:crypto";
import {
  DiscordAdminError,
  requestDiscordAdmin,
  type DiscordAdminState,
} from "@/lib/discord-admin";
import type { AdminRequest } from "@/shared/discord-admin-protocol";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  assertAdminAction,
  clearAdminCookie,
  getAdminOperator,
  setAdminCookie,
  type Operator,
} from "@/lib/auth";
import {
  manualPaymentProofRequestMessage,
  paymentProofRequestKeyboard,
  sendRenewalReminder,
} from "@/lib/bot";
import { createV2Invite } from "@/lib/bot/v2";
import { sendV2RenewalReminder } from "@/lib/bot/v2-job";
import {
  recheckQualifications,
  reserveBoundAccount,
  withQualificationLock,
} from "@/lib/qualification";
import {
  amountAtLeast,
  effectiveMembership,
  exchangeLabel,
  normalizeExchange,
  validPastDate,
  v2Enabled,
} from "@/lib/membership-v2";
import { hasTrustedPaidPeriod } from "@/app/admin/payment-policy";
import { getAdminPassword, getRuntimeConfig } from "@/lib/config";
import {
  addDays,
  addMonths,
  formatDateTime,
  isoDateTime,
  renewalBaseDate,
} from "@/lib/dates";
import {
  getMembershipState,
  isPaymentFollowupCandidate,
  isPaymentPending,
  isPaymentReviewReady,
  isRenewalNoticeCandidate,
} from "@/lib/member-state";
import {
  getMemberByPageId,
  listMembers,
  updateMember,
  updateMemberExistingProperties,
  type Member,
  type MemberPatch,
} from "@/lib/notion";
import {
  isMemberStatus,
  memberStatusLabel,
  nonExpiringStatuses,
  selectableStatuses,
} from "@/lib/status";
import {
  createChatInviteLink,
  revokeChatInviteLink,
  sendMessage,
  unbanChatMember,
} from "@/lib/telegram";

const statusSchema = z.object({
  status: z.string().refine(isMemberStatus),
});

async function withAdminAction<T>(
  pageId: string,
  fn: (operator: Operator) => Promise<T>,
): Promise<T> {
  await assertAdminAction();
  const operator = await getAdminOperator();
  try {
    return await fn(operator);
  } finally {
    revalidatePath("/admin");
    revalidatePath(`/admin/member/${pageId}`);
  }
}

// V2 authoritative member writes share the scan lease; legacy actions need no D1.
async function withV2MemberMutation<T>(
  pageId: string,
  mutation: (guard: () => Promise<void>) => Promise<T>,
): Promise<T> {
  if (v2Enabled()) return withQualificationLock(pageId, mutation);
  return mutation(async () => {});
}

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") || "");
  if (password !== getAdminPassword()) {
    redirect("/admin/login?error=1");
  }
  const operator = String(formData.get("operator") || "");
  await setAdminCookie(operator);
  redirect("/admin");
}

export async function logoutAction() {
  await clearAdminCookie();
  redirect("/admin/login");
}

export async function updateStatusAction(pageId: string, formData: FormData) {
  await withAdminAction(pageId, async (operator) => {
    await withV2MemberMutation(pageId, async (guard) => {
      const parsed = statusSchema.parse({
        status: formData.get("status"),
      });
      if (
        v2Enabled() &&
        !selectableStatuses().some((status) => status === parsed.status)
      ) {
        throw new Error("此狀態須由付款核准或資格檢查產生，無法直接指定。");
      }
      await guard();
      await updateMember(pageId, {
        status: parsed.status,
        lastBotCheckAt: isoDateTime(new Date()),
        lastBotMessage: `Status changed manually by ${operator}`,
      });
    });
  });
}

export async function markPaidAction(
  pageId: string,
  durationMonths: 1 | 3 = 1,
) {
  await withAdminAction(pageId, async (operator) => {
    await withV2MemberMutation(pageId, async (guard) => {
      if (![1, 3].includes(durationMonths))
        throw new Error("訂閱方案僅限 1 或 3 個月。");
      const now = new Date();
      const member = await getMemberByPageId(pageId);
      if (!member) throw new Error("找不到會員。");
      const policyV2 = v2Enabled();
      const retainPriority =
        nonExpiringStatuses.has(member.status) ||
        ["suspended", "kicked", "denied"].includes(member.status);
      const trustedPreviousPaidPeriod = hasTrustedPaidPeriod(member, now);
      const elapsed = member.paidAt
        ? now.getTime() - Date.parse(member.paidAt)
        : NaN;
      if (
        member.paidAt &&
        elapsed >= 0 &&
        elapsed < 60_000 &&
        (!policyV2 || trustedPreviousPaidPeriod)
      ) {
        // Guards against double-submit re-adding another billing period.
        return;
      }

      const baseDate =
        policyV2 && !trustedPreviousPaidPeriod
          ? now
          : renewalBaseDate(member.reviewDueAt, now);
      const reviewDueAt = addMonths(baseDate, durationMonths);
      const label = `${durationMonths} month${durationMonths > 1 ? "s" : ""}`;
      // This action is a new trusted approval; ambiguous legacy labels cannot
      // grant on their own or supply a prior paid cutoff for extension.
      const approvedStatus = policyV2
        ? effectiveMembership(
            {
              ...member,
              status: retainPriority ? member.status : "active_paid",
              paidAt: isoDateTime(now),
              reviewDueAt: isoDateTime(reviewDueAt),
            },
            now,
          )
        : "active_paid";

      await guard();
      await updateMember(pageId, {
        status: approvedStatus,
        ...(policyV2
          ? {
              paymentUidLast4: "",
              paymentProofFileId: "",
              paymentProofSubmittedAt: null,
            }
          : {}),
        paidAt: isoDateTime(now),
        subscriptionMonths: durationMonths,
        reviewDueAt: isoDateTime(reviewDueAt),
        paymentDeadlineAt: null,
        renewalStep: "",
        renewalReminderSentAt: null,
        renewalReminder3DaySentAt: null,
        renewalReminderDueAt: null,
        kickReason:
          policyV2 && ["suspended", "kicked", "denied"].includes(member.status)
            ? member.kickReason
            : "",
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: `Marked paid by ${operator} (${label})`,
      });
      if (member.telegramUserId) {
        await sendMessage(
          member.telegramUserId,
          policyV2
            ? `付款已核准（${durationMonths} 個月），付費期限至 ${formatDateTime(isoDateTime(reviewDueAt))}。目前會籍：${memberStatusLabel(approvedStatus)}。Telegram 群組資格不受會籍到期影響。`
            : `訂閱已更新，目前為有效狀態，有效期限至 ${formatDateTime(isoDateTime(reviewDueAt))}。Telegram 群組資格不受會籍到期影響。`,
        );
      }
    });
  });
}

export async function requestPaymentProofAction(pageId: string) {
  await withAdminAction(pageId, async (operator) => {
    await withV2MemberMutation(pageId, async (guard) => {
      const now = new Date();

      try {
        const member = await getMemberByPageId(pageId);
        if (!member) return;

        if (!member.telegramUserId) {
          await updateMemberExistingProperties(pageId, {
            lastBotCheckAt: isoDateTime(now),
            lastBotMessage:
              "Manual payment proof request skipped: member has no Telegram User ID",
          }).catch(() => []);
          return;
        }

        const config = getRuntimeConfig();
        const deadline = addDays(now, config.paymentGraceDays);
        const membershipIsActive =
          getMembershipState(member, now).state === "active";
        const continueCurrentRequest =
          isPaymentReviewReady(member) ||
          (isPaymentPending(member) &&
            Boolean(member.paymentDeadlineAt) &&
            Date.parse(member.paymentDeadlineAt!) > now.getTime());
        await guard();
        const updatedProperties = await updateMemberExistingProperties(pageId, {
          ...(!v2Enabled() &&
          membershipIsActive &&
          !nonExpiringStatuses.has(member.status)
            ? { status: "payment_pending" as const }
            : {}),
          renewalStep: "payment_pending",
          ...(continueCurrentRequest
            ? {}
            : {
                paymentDeadlineAt: isoDateTime(deadline),
                paymentUidLast4: "",
                paymentProofFileId: "",
                paymentProofSubmittedAt: null,
              }),
          lastBotCheckAt: isoDateTime(now),
          lastBotMessage: `Manual payment proof option sent by ${operator}`,
        });

        if (!updatedProperties.includes("Renewal Step")) {
          await updateMemberExistingProperties(pageId, {
            lastBotCheckAt: isoDateTime(now),
            lastBotMessage:
              "Manual payment proof option skipped: Notion Renewal Step property was not found",
          }).catch(() => []);
          return;
        }

        try {
          await sendMessage(
            member.telegramUserId,
            continueCurrentRequest
              ? "你的付款申請仍在處理中。已收到的資料會保留，請補齊尚缺的轉帳截圖或 UID 末四碼；資料已齊全者請等待助理審核。"
              : manualPaymentProofRequestMessage(),
            continueCurrentRequest ? undefined : paymentProofRequestKeyboard(),
          );
        } catch (error) {
          await updateMemberExistingProperties(pageId, {
            lastBotCheckAt: isoDateTime(now),
            lastBotMessage: `Manual payment proof option failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          }).catch(() => []);
        }
      } catch (error) {
        console.error("requestPaymentProofAction failed", error);
        await updateMemberExistingProperties(pageId, {
          lastBotCheckAt: isoDateTime(now),
          lastBotMessage: `Manual payment proof action failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }).catch(() => []);
      }
    });
  });
}

export async function resendRenewalRemindersAction() {
  await assertAdminAction();
  const operator = await getAdminOperator();
  const now = new Date();
  const members = await listMembers({ limit: 500 });

  let sentCount = 0;
  for (const member of members) {
    if (v2Enabled()) {
      const stage = isRenewalNoticeCandidate(member, now, {
        stage: "3day",
        allowAlreadyReminded: true,
      })
        ? "3day"
        : "7day";
      if (
        isRenewalNoticeCandidate(member, now, {
          stage,
          allowAlreadyReminded: true,
        })
      ) {
        // D1 owns the cutoff/stage key and holds unknown outcomes for review.
        await sendV2RenewalReminder(member, now, stage);
        sentCount += 1;
      }
      continue;
    }
    if (isPaymentFollowupCandidate(member, now)) {
      await sendMessage(
        member.telegramUserId,
        [
          "你的付款資料尚未完整，已收到的內容會保留。",
          "請補齊轉帳截圖與 UID 末四碼（4 位數字），已完成的項目不用重傳。",
          `付款資料截止：${formatDateTime(member.paymentDeadlineAt)}`,
          `原會籍到期：${formatDateTime(member.reviewDueAt)}；Telegram 群組資格保留。`,
        ].join("\n"),
      );
      await updateMember(member.pageId, {
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: `Payment follow-up resent manually by ${operator}`,
      });
      sentCount += 1;
      continue;
    }
    const stage = isRenewalNoticeCandidate(member, now, {
      stage: "3day",
      allowAlreadyReminded: true,
    })
      ? "3day"
      : "7day";
    if (
      isRenewalNoticeCandidate(member, now, {
        stage,
        allowAlreadyReminded: true,
      })
    ) {
      await sendRenewalReminder(
        member,
        now,
        `Renewal reminder resent manually by ${operator}`,
        stage,
      );
      sentCount += 1;
    }
  }

  revalidatePath("/admin");
  redirect(`/admin?resent=${sentCount}`);
}

export async function batchMarkEligibleAction(formData: FormData) {
  await assertAdminAction();
  const operator = await getAdminOperator();
  const raw = String(formData.get("pageIds") || "[]");
  const parsed = z.array(z.string().min(1)).safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("Invalid member selection");

  const pageIds = [...new Set(parsed.data)].slice(0, 500);
  const now = isoDateTime(new Date());
  if (v2Enabled()) for (const pageId of pageIds) await readV2Member(pageId);
  for (const pageId of pageIds) {
    await updateMember(pageId, {
      ...(v2Enabled()
        ? {
            onboardingStep: "needs_review",
            depositReviewReason:
              "CSV 僅比對 UID，尚未證明推薦關係或歷史累計入金；請個別覆核。",
          }
        : { status: "eligible" as const, kickReason: "" }),
      lastBotCheckAt: now,
      lastBotMessage: v2Enabled()
        ? `CSV identity match queued for qualification review by ${operator}`
        : `Marked eligible from MEXC CSV comparison by ${operator}`,
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/applications");
  redirect(`/admin/applications?approved=${pageIds.length}`);
}

export async function markInvitationEmailSentAction(pageId: string) {
  await withAdminAction(pageId, async (operator) => {
    await updateMember(pageId, {
      invitationEmailSent: true,
      lastBotCheckAt: isoDateTime(new Date()),
      lastBotMessage: `Invitation email marked sent by ${operator}`,
    });
  });
}

export async function extendTrialAction(pageId: string) {
  await withAdminAction(pageId, async (operator) => {
    if (v2Enabled())
      throw new Error("新版會籍沒有試用期，請使用付款核准或資格檢查。");
    const now = new Date();
    const member = await getMemberByPageId(pageId);
    if (!member) throw new Error("Member not found");

    const base = renewalBaseDate(member.reviewDueAt, now);
    const newReviewDueAt = addMonths(base, 1);

    await updateMember(pageId, {
      status: "trial_active",
      reviewDueAt: isoDateTime(newReviewDueAt),
      renewalStep: "",
      renewalReminderSentAt: null,
      renewalReminder3DaySentAt: null,
      renewalReminderDueAt: null,
      kickReason: "",
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: `Trial extended by 1 month by ${operator}`,
    });

    if (member.telegramUserId) {
      await sendMessage(
        member.telegramUserId,
        `管理員已為你延長體驗期，新的到期日為 ${formatDateTime(isoDateTime(newReviewDueAt))}，繼續加油！`,
      );
    }
  });
}

export async function kickMemberAction(pageId: string) {
  await withAdminAction(pageId, async (operator) => {
    await withV2MemberMutation(pageId, async (guard) => {
      const member = await getMemberByPageId(pageId);
      if (!member) throw new Error("Member not found");

      await guard();
      await updateMember(pageId, {
        status: v2Enabled() ? "suspended" : "kicked",
        kickReason: "manual_membership_disabled",
        lastBotCheckAt: isoDateTime(new Date()),
        lastBotMessage: `Membership disabled by ${operator}; Telegram membership retained`,
      });
    });
  });
}

export async function resendInviteAction(pageId: string) {
  await withAdminAction(pageId, async (operator) => {
    const member = await getMemberByPageId(pageId);
    if (!member) throw new Error("Member not found");

    if (v2Enabled()) {
      if (["suspended", "denied", "kicked"].includes(member.status))
        throw new Error("請先處理已停用的會籍。");
      if (!member.telegramUserId)
        throw new Error("此會員尚未綁定 Telegram 帳號。");
      await createV2Invite(member, member.telegramUserId, new Date());
      return;
    }
    if (member.status === "denied" || member.status === "kicked") {
      throw new Error("請先處理已拒絕或停用的會籍，再重新發送入群連結。");
    }
    if (!member.telegramUserId)
      throw new Error("此會員尚未綁定 Telegram 帳號。");
    await unbanChatMember(member.telegramUserId);

    const expiresAt = addDays(new Date(), 1);
    const invite = await createChatInviteLink({
      name: `admin-${member.telegramUserId}`.slice(0, 32),
      expireDate: expiresAt,
    });
    const initialJoin =
      ["eligible", "collecting_info", "invite_sent", "join_pending"].includes(
        member.status,
      ) &&
      !member.groupJoinedAt &&
      !member.reviewDueAt &&
      !member.paidAt;
    await updateMember(pageId, {
      ...(initialJoin ? { status: "join_pending" as const } : {}),
      inviteLink: invite.invite_link,
      inviteExpiresAt: isoDateTime(expiresAt),
      lastBotCheckAt: isoDateTime(new Date()),
      lastBotMessage: `Invite resent manually by ${operator}`,
    });
    if (member.telegramUserId) {
      await sendMessage(
        member.telegramUserId,
        `管理員已重新產生你的專屬入群連結：\n${invite.invite_link}`,
      );
    }
  });
}

export async function revokeInviteAction(pageId: string) {
  await withAdminAction(pageId, async (operator) => {
    const member = await getMemberByPageId(pageId);
    if (!member) throw new Error("Member not found");

    if (member.inviteLink) {
      await revokeChatInviteLink(member.inviteLink);
    }
    await updateMember(pageId, {
      inviteLink: null,
      inviteExpiresAt: null,
      lastBotCheckAt: isoDateTime(new Date()),
      lastBotMessage: `Invite revoked manually by ${operator}`,
    });
  });
}

export async function clearInviteAction(pageId: string) {
  await withAdminAction(pageId, async (operator) => {
    await updateMember(pageId, {
      inviteLink: null,
      inviteExpiresAt: null,
      lastBotCheckAt: isoDateTime(new Date()),
      lastBotMessage: `Invite fields cleared manually by ${operator}`,
    });
  });
}

async function readV2Member(pageId: string): Promise<Member> {
  if (!v2Enabled()) throw new Error("新版會員政策尚未啟用。");
  const member = await getMemberByPageId(pageId);
  if (!member) throw new Error("找不到會員。");
  if (member.qualificationFieldsAvailable === false)
    throw new Error("Notion 資格欄位尚未備妥，請先完成設定。");
  return member;
}

function sameAccount(left: Member, right: Member) {
  return (
    normalizeExchange(left.exchangeName) ===
      normalizeExchange(right.exchangeName) &&
    left.exchangeUid === right.exchangeUid
  );
}

export async function recheckQualificationAction(pageId: string) {
  await withAdminAction(pageId, async (operator) => {
    await readV2Member(pageId);
    const now = new Date();
    await recheckQualifications(pageId, now);
    await updateMember(pageId, {
      lastBotCheckAt: now.toISOString(),
      lastBotMessage: `Qualification rechecked by ${operator}`,
    });
  });
}

export async function approveHistoricalDepositAction(
  pageId: string,
  formData: FormData,
) {
  await withAdminAction(pageId, async (operator) => {
    if (!v2Enabled()) throw new Error("新版會員政策尚未啟用。");
    await withQualificationLock(pageId, async (guard) => {
      const member = await readV2Member(pageId);
      const reason = String(formData.get("reason") ?? "").trim();
      const amount = String(formData.get("verifiedDepositUsdt") ?? "").trim();
      if (!reason || reason.length > 1000)
        throw new Error("請填寫具體覆核依據（最多 1000 字）。");
      if (
        !/^\d+(?:\.\d{1,36})?$/.test(amount) ||
        amount.length > 120 ||
        !Number.isFinite(Number(amount)) ||
        !amountAtLeast(amount, "100")
      )
        throw new Error("核實的歷史累計入金須至少 100 USDT。");
      const now = new Date();
      const fresh = await readV2Member(pageId);
      if (!sameAccount(member, fresh))
        throw new Error("綁定帳號已變更，請重新核對。");
      const exchange = normalizeExchange(fresh.exchangeName);
      if (!exchange || !/^\d{1,32}$/.test(fresh.exchangeUid))
        throw new Error("請先核對綁定交易所與 UID。");
      if (
        !fresh.exchangeRegistered &&
        !validPastDate(fresh.admissionVerifiedAt, now)
      )
        throw new Error("尚無已驗證推薦關係，不能只依入金證明核准。");
      const all = await listMembers();
      if (
        all.some(
          (other) =>
            other.pageId !== pageId &&
            normalizeExchange(other.exchangeName) === exchange &&
            other.exchangeUid.trim() === fresh.exchangeUid,
        )
      )
        throw new Error("此交易所與 UID 已綁定其他會員，請先處理重複紀錄。");
      await guard();
      await reserveBoundAccount(pageId, exchange, fresh.exchangeUid);
      const patch: MemberPatch = {
        admissionVerifiedAt: validPastDate(fresh.admissionVerifiedAt, now)
          ? fresh.admissionVerifiedAt
          : now.toISOString(),
        verifiedDepositUsdt: Math.max(
          Number(amount),
          fresh.verifiedDepositUsdt ?? 0,
        ),
        depositEvidenceComplete:
          formData.get("evidenceComplete") === "on" ||
          formData.get("evidenceComplete") === "true",
        depositReviewReason: reason,
        depositReviewedAt: now.toISOString(),
        depositReviewedBy: operator,
        onboardingStep: fresh.groupJoinedAt ? "joined" : "eligible",
        lastBotCheckAt: now.toISOString(),
        lastBotMessage: `Historical deposit evidence reviewed by ${operator}`,
      };
      patch.status = effectiveMembership({ ...fresh, ...patch }, now);
      await guard();
      await updateMember(pageId, patch);
    });
  });
}

export async function resetBoundAccountAction(
  pageId: string,
  formData: FormData,
) {
  await withAdminAction(pageId, async (operator) => {
    if (!v2Enabled()) throw new Error("新版會員政策尚未啟用。");
    await withQualificationLock(pageId, async (guard) => {
      const member = await readV2Member(pageId);
      const exchange = z
        .enum(["mexc", "bitget", "okx"])
        .parse(formData.get("exchange"));
      const uid = formData.get("exchangeUid");
      if (typeof uid !== "string" || !/^\d{1,32}$/.test(uid.trim()))
        throw new Error("請填寫數字 UID（最多 32 位），保留前導零。");
      const exchangeUid = uid.trim();
      if (
        normalizeExchange(member.exchangeName) === exchange &&
        member.exchangeUid === exchangeUid
      )
        return;
      const all = await listMembers();
      if (
        all.some(
          (other) =>
            other.pageId !== pageId &&
            normalizeExchange(other.exchangeName) === exchange &&
            other.exchangeUid.trim() === exchangeUid,
        )
      )
        throw new Error("此交易所與 UID 已綁定其他會員，請先處理重複紀錄。");
      await guard();
      await reserveBoundAccount(pageId, exchange, exchangeUid);
      if (member.inviteLink) await revokeChatInviteLink(member.inviteLink);
      const fresh = await readV2Member(pageId);
      if (!sameAccount(member, fresh))
        throw new Error("綁定帳號已變更，請重新核對。");
      const now = new Date();
      const patch: MemberPatch = {
        exchangeName: exchangeLabel(exchange),
        exchangeUid,
        uidSubmittedAt: now.toISOString(),
        exchangeRegistered: false,
        onboardingStep: "collecting_info",
        admissionVerifiedAt: null,
        verifiedDepositUsdt: null,
        depositEvidenceComplete: false,
        depositReviewReason: "綁定帳號已變更，須重新核對推薦關係與歷史入金。",
        depositReviewedAt: null,
        depositReviewedBy: "",
        volumeSpot30d: null,
        volumeFutures30d: null,
        volumeTotal30d: null,
        volumeQualified: false,
        volumeWindowStart: null,
        volumeWindowEnd: null,
        volumeCheckedAt: null,
        volumeCheckError: "",
        qualificationCheckedAt: null,
        inviteLink: null,
        inviteExpiresAt: null,
        invitationEmailSent: false,
        lastBotCheckAt: now.toISOString(),
        lastBotMessage: `Bound exchange account reset by ${operator}; Discord re-verification required`,
      };
      patch.status = effectiveMembership({ ...fresh, ...patch }, now);
      await guard();
      await updateMember(pageId, patch);
    });
  });
}

async function discordAdminAction(
  pageId: string,
  discordId: string,
  verifiedAt: string | null,
  action: AdminRequest["action"],
  formData: FormData,
): Promise<DiscordAdminState> {
  return withAdminAction(pageId, async (operator) => {
    if (action === "unlink" && formData.get("confirmUnlink") !== "yes")
      return { kind: "error", message: "請先確認解除 DC 綁定。" };
    try {
      return await withV2MemberMutation(pageId, async (guard) => {
        try {
          const member = await getMemberByPageId(pageId);
          const date = (value: string | null) =>
            value ? Date.parse(value) : null;
          if (
            !member ||
            !discordId ||
            member.discordId !== discordId ||
            date(member.discordVerifiedAt) !== date(verifiedAt)
          )
            throw new DiscordAdminError(
              "綁定資料已變更，請重新整理會員頁面後確認。",
            );
          await guard();
          const result = await requestDiscordAdmin({
            action,
            requestId: randomUUID(),
            pageId: member.pageId,
            discordId,
            verifiedAt: date(member.discordVerifiedAt),
            operator,
          });
          await guard();
          await updateMemberExistingProperties(pageId, {
            lastBotCheckAt: new Date().toISOString(),
            lastBotMessage: `DC ${action} handled by ${operator}: ${result.message}`,
          });
          return { kind: "success", message: result.message };
        } catch (error) {
          const message =
            error instanceof DiscordAdminError
              ? error.message
              : "DC 操作尚未確認完成，請重新整理會員頁面查看結果。";
          await guard();
          await updateMemberExistingProperties(pageId, {
            lastBotCheckAt: new Date().toISOString(),
            lastBotMessage: `DC ${action} unconfirmed by ${operator}: ${message}`,
          });
          return { kind: "error", message };
        }
      });
    } catch {
      return {
        kind: "error",
        message:
          "會員資料目前正在處理，或操作紀錄尚未確認；請重新整理查看結果後再試。",
      };
    }
  });
}
export async function syncDiscordRoleAction(
  pageId: string,
  discordId: string,
  verifiedAt: string | null,
  _previous: DiscordAdminState,
  formData: FormData,
): Promise<DiscordAdminState> {
  return discordAdminAction(pageId, discordId, verifiedAt, "sync", formData);
}
export async function unlinkDiscordAction(
  pageId: string,
  discordId: string,
  verifiedAt: string | null,
  _previous: DiscordAdminState,
  formData: FormData,
): Promise<DiscordAdminState> {
  return discordAdminAction(pageId, discordId, verifiedAt, "unlink", formData);
}
