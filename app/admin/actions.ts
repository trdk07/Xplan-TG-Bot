"use server";

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
} from "@/lib/notion";
import { isMemberStatus, nonExpiringStatuses } from "@/lib/status";
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
    const parsed = statusSchema.parse({
      status: formData.get("status"),
    });
    await updateMember(pageId, {
      status: parsed.status,
      lastBotCheckAt: isoDateTime(new Date()),
      lastBotMessage: `Status changed manually by ${operator}`,
    });
  });
}

export async function markPaidAction(pageId: string, durationMonths: 1 | 3 = 1) {
  await withAdminAction(pageId, async (operator) => {
    const now = new Date();
    const member = await getMemberByPageId(pageId);
    if (!member) throw new Error("Member not found");

    if (member.paidAt && now.getTime() - new Date(member.paidAt).getTime() < 60_000) {
      // Guards against double-submit re-adding another billing period.
      return;
    }

    const baseDate = renewalBaseDate(member.reviewDueAt, now);
    const reviewDueAt = addMonths(baseDate, durationMonths);
    const label = `${durationMonths} month${durationMonths > 1 ? "s" : ""}`;

    await updateMember(pageId, {
      status: "active_paid",
      paidAt: isoDateTime(now),
      subscriptionMonths: durationMonths,
      reviewDueAt: isoDateTime(reviewDueAt),
      paymentDeadlineAt: null,
      renewalStep: "",
      renewalReminderSentAt: null,
      renewalReminder3DaySentAt: null,
      renewalReminderDueAt: null,
      kickReason: "",
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: `Marked paid by ${operator} (${label})`,
    });
    if (member.telegramUserId) {
      await sendMessage(
        member.telegramUserId,
        `訂閱已更新，目前為有效狀態，有效期限至 ${formatDateTime(isoDateTime(reviewDueAt))}。Telegram 群組資格不受會籍到期影響。`,
      );
    }
  });
}

export async function requestPaymentProofAction(pageId: string) {
  await withAdminAction(pageId, async (operator) => {
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
      const membershipIsActive = getMembershipState(member, now).state === "active";
      const continueCurrentRequest = isPaymentReviewReady(member) || (
        isPaymentPending(member) && Boolean(member.paymentDeadlineAt)
        && Date.parse(member.paymentDeadlineAt!) > now.getTime()
      );
      const updatedProperties = await updateMemberExistingProperties(pageId, {
        ...(membershipIsActive && !nonExpiringStatuses.has(member.status)
          ? { status: "payment_pending" as const }
          : {}),
        renewalStep: "payment_pending",
        ...(continueCurrentRequest ? {} : {
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
}

export async function resendRenewalRemindersAction() {
  await assertAdminAction();
  const operator = await getAdminOperator();
  const now = new Date();
  const members = await listMembers({ limit: 500 });

  let sentCount = 0;
  for (const member of members) {
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
    const stage = isRenewalNoticeCandidate(member, now, { stage: "3day", allowAlreadyReminded: true }) ? "3day" : "7day";
    if (isRenewalNoticeCandidate(member, now, { stage, allowAlreadyReminded: true })) {
      await sendRenewalReminder(member, now, `Renewal reminder resent manually by ${operator}`, stage);
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
  for (const pageId of pageIds) {
    await updateMember(pageId, {
      status: "eligible",
      lastBotCheckAt: now,
      lastBotMessage: `Marked eligible from MEXC CSV comparison by ${operator}`,
      kickReason: "",
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
    const member = await getMemberByPageId(pageId);
    if (!member) throw new Error("Member not found");

    await updateMember(pageId, {
      status: "kicked",
      kickReason: "manual_membership_disabled",
      lastBotCheckAt: isoDateTime(new Date()),
      lastBotMessage: `Membership disabled by ${operator}; Telegram membership retained`,
    });
  });
}

export async function resendInviteAction(pageId: string) {
  await withAdminAction(pageId, async (operator) => {
    const member = await getMemberByPageId(pageId);
    if (!member) throw new Error("Member not found");

    if (member.status === "denied" || member.status === "kicked") {
      throw new Error("請先處理已拒絕或停用的會籍，再重新發送入群連結。");
    }
    if (!member.telegramUserId) throw new Error("此會員尚未綁定 Telegram 帳號。");
    await unbanChatMember(member.telegramUserId);

    const expiresAt = addDays(new Date(), 1);
    const invite = await createChatInviteLink({
      name: `admin-${member.telegramUserId}`.slice(0, 32),
      expireDate: expiresAt,
    });
    const initialJoin = ["eligible", "collecting_info", "invite_sent", "join_pending"].includes(member.status)
      && !member.groupJoinedAt && !member.reviewDueAt && !member.paidAt;
    await updateMember(pageId, {
      ...(initialJoin ? { status: "join_pending" as const } : {}),
      inviteLink: invite.invite_link,
      inviteExpiresAt: isoDateTime(expiresAt),
      lastBotCheckAt: isoDateTime(new Date()),
      lastBotMessage: `Invite resent manually by ${operator}`,
    });
    if (member.telegramUserId) {
      await sendMessage(member.telegramUserId, `管理員已重新產生你的專屬入群連結：\n${invite.invite_link}`);
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
