"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertAdminAction, clearAdminCookie, setAdminCookie } from "@/lib/auth";
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
  isPaymentFollowupCandidate,
  isRenewalNoticeCandidate,
} from "@/lib/member-state";
import {
  getMemberByPageId,
  listMembers,
  updateMember,
  updateMemberExistingProperties,
} from "@/lib/notion";
import { isMemberStatus } from "@/lib/status";
import {
  createChatInviteLink,
  kickChatMember,
  revokeChatInviteLink,
  sendMessage,
  unbanChatMember,
} from "@/lib/telegram";

const statusSchema = z.object({
  status: z.string().refine(isMemberStatus),
});

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") || "");
  if (password !== getAdminPassword()) {
    redirect("/admin/login?error=1");
  }
  await setAdminCookie();
  redirect("/admin");
}

export async function logoutAction() {
  await clearAdminCookie();
  redirect("/admin/login");
}

export async function updateStatusAction(pageId: string, formData: FormData) {
  await assertAdminAction();
  const parsed = statusSchema.parse({
    status: formData.get("status"),
  });
  await updateMember(pageId, {
    status: parsed.status,
    lastBotCheckAt: isoDateTime(new Date()),
    lastBotMessage: "Status changed manually by admin",
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/member/${pageId}`);
}

export async function markPaidAction(pageId: string, durationMonths: 1 | 3 = 1) {
  await assertAdminAction();
  const now = new Date();
  const member = await getMemberByPageId(pageId);
  if (!member) throw new Error("Member not found");

  const wasKicked = Boolean(member.kickReason);
  const baseDate = renewalBaseDate(member.reviewDueAt, now);
  const reviewDueAt = addMonths(baseDate, durationMonths);
  const label = `${durationMonths} month${durationMonths > 1 ? "s" : ""}`;

  if (wasKicked && member.telegramUserId) {
    // Member was previously kicked — generate invite link so they can rejoin
    await unbanChatMember(member.telegramUserId);
    const expiresAt = addDays(now, 1);
    const invite = await createChatInviteLink({
      name: `paid-${member.telegramUserId}`.slice(0, 32),
      expireDate: expiresAt,
    });
    await updateMember(pageId, {
      status: "join_pending",
      paidAt: isoDateTime(now),
      reviewDueAt: isoDateTime(reviewDueAt),
      paymentDeadlineAt: null,
      renewalStep: "",
      renewalReminderSentAt: null,
      kickReason: "",
      inviteLink: invite.invite_link,
      inviteExpiresAt: isoDateTime(expiresAt),
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: `Marked paid by admin (${label}), invite sent for rejoin`,
    });
    await sendMessage(
      member.telegramUserId,
      [
        "你的訂閱已審核通過！",
        "",
        `有效期限至 ${formatDateTime(isoDateTime(reviewDueAt))}。`,
        "",
        "請點擊下方專屬連結重新加入群組（連結僅可使用一次，並於 24 小時後失效）：",
        invite.invite_link,
      ].join("\n"),
    );
  } else {
    await updateMember(pageId, {
      status: "active_paid",
      paidAt: isoDateTime(now),
      reviewDueAt: isoDateTime(reviewDueAt),
      paymentDeadlineAt: null,
      renewalStep: "",
      renewalReminderSentAt: null,
      kickReason: "",
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: `Marked paid by admin (${label})`,
    });
    if (member.telegramUserId) {
      await sendMessage(
        member.telegramUserId,
        `訂閱已更新，目前為有效狀態，有效期限至 ${formatDateTime(isoDateTime(reviewDueAt))}。`,
      );
    }
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/member/${pageId}`);
}

export async function requestPaymentProofAction(pageId: string) {
  await assertAdminAction();
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
      revalidatePath("/admin");
      revalidatePath(`/admin/member/${pageId}`);
      return;
    }

    const config = getRuntimeConfig();
    const deadline = addDays(now, config.paymentGraceDays);
    const updatedProperties = await updateMemberExistingProperties(pageId, {
      status: "payment_pending",
      renewalStep: "payment_pending",
      paymentDeadlineAt: isoDateTime(deadline),
      paymentUidLast4: "",
      paymentProofFileId: "",
      paymentProofSubmittedAt: null,
      paidAt: null,
      lastBotCheckAt: isoDateTime(now),
      lastBotMessage: "Manual payment proof option sent by admin",
    });

    if (!updatedProperties.includes("Status")) {
      await updateMemberExistingProperties(pageId, {
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage:
          "Manual payment proof option skipped: Notion Status property was not found",
      }).catch(() => []);
      return;
    }

    try {
      await sendMessage(
        member.telegramUserId,
        manualPaymentProofRequestMessage(),
        paymentProofRequestKeyboard(),
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
  } finally {
    revalidatePath("/admin");
    revalidatePath(`/admin/member/${pageId}`);
  }
}

export async function resendRenewalRemindersAction() {
  await assertAdminAction();
  const now = new Date();
  const members = await listMembers({ limit: 500 });

  let sentCount = 0;
  for (const member of members) {
    if (
      isRenewalNoticeCandidate(member, now, {
        allowAlreadyReminded: true,
      })
    ) {
      await sendRenewalReminder(
        member,
        now,
        "Renewal reminder resent manually by admin",
      );
      sentCount += 1;
      continue;
    }

    if (isPaymentFollowupCandidate(member, now)) {
      await sendMessage(
        member.telegramUserId,
        [
          "你目前已在續費付款流程中，但付款資料尚未完整。",
          "",
          "請上傳轉帳截圖，並回覆 UID 末四碼（4 位數字）。",
          "如果已完成其中一項，請補上另一項即可。",
        ].join("\n"),
      );
      await updateMember(member.pageId, {
        lastBotCheckAt: isoDateTime(now),
        lastBotMessage: "Payment follow-up resent manually by admin",
      });
      sentCount += 1;
    }
  }

  revalidatePath("/admin");
  redirect(`/admin?resent=${sentCount}`);
}

export async function batchMarkEligibleAction(formData: FormData) {
  await assertAdminAction();
  const raw = String(formData.get("pageIds") || "[]");
  const parsed = z.array(z.string().min(1)).safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("Invalid member selection");

  const pageIds = [...new Set(parsed.data)].slice(0, 500);
  const now = isoDateTime(new Date());
  for (const pageId of pageIds) {
    await updateMember(pageId, {
      status: "eligible",
      lastBotCheckAt: now,
      lastBotMessage: "Marked eligible from MEXC CSV comparison",
      kickReason: "",
    });
  }

  revalidatePath("/admin");
  revalidatePath("/admin/applications");
  redirect(`/admin/applications?approved=${pageIds.length}`);
}

export async function markInvitationEmailSentAction(pageId: string) {
  await assertAdminAction();
  await updateMember(pageId, {
    invitationEmailSent: true,
    lastBotCheckAt: isoDateTime(new Date()),
    lastBotMessage: "Invitation email marked sent by admin",
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/member/${pageId}`);
}

export async function kickMemberAction(pageId: string) {
  await assertAdminAction();
  const member = await getMemberByPageId(pageId);
  if (!member) throw new Error("Member not found");

  if (member.telegramUserId) {
    await kickChatMember(member.telegramUserId);
  }
  await updateMember(pageId, {
    status: "kicked",
    kickReason: "manual_admin_kick",
    lastBotCheckAt: isoDateTime(new Date()),
    lastBotMessage: "Kicked manually by admin",
    ...(member.tradingView ? { tradingViewAccess: "待撤銷" } : {}),
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/member/${pageId}`);
}

export async function markTradingViewRevokedAction(pageId: string) {
  await assertAdminAction();
  await updateMember(pageId, {
    tradingViewAccess: "已撤銷",
    lastBotCheckAt: isoDateTime(new Date()),
    lastBotMessage: "TradingView access marked revoked by admin",
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/member/${pageId}`);
}

export async function resendInviteAction(pageId: string) {
  await assertAdminAction();
  const member = await getMemberByPageId(pageId);
  if (!member) throw new Error("Member not found");

  if (member.telegramUserId) {
    await unbanChatMember(member.telegramUserId);
  }

  const expiresAt = addDays(new Date(), 1);
  const invite = await createChatInviteLink({
    name: `admin-${member.telegramUserId}`.slice(0, 32),
    expireDate: expiresAt,
  });
  await updateMember(pageId, {
    status: "join_pending",
    inviteLink: invite.invite_link,
    inviteExpiresAt: isoDateTime(expiresAt),
    lastBotCheckAt: isoDateTime(new Date()),
    lastBotMessage: "Invite resent manually by admin",
  });
  if (member.telegramUserId) {
    await sendMessage(member.telegramUserId, `管理員已重新產生你的專屬入群連結：\n${invite.invite_link}`);
  }
  revalidatePath("/admin");
  revalidatePath(`/admin/member/${pageId}`);
}

export async function revokeInviteAction(pageId: string) {
  await assertAdminAction();
  const member = await getMemberByPageId(pageId);
  if (!member) throw new Error("Member not found");

  if (member.inviteLink) {
    await revokeChatInviteLink(member.inviteLink);
  }
  await updateMember(pageId, {
    inviteLink: null,
    inviteExpiresAt: null,
    lastBotCheckAt: isoDateTime(new Date()),
    lastBotMessage: "Invite revoked manually by admin",
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/member/${pageId}`);
}

export async function clearInviteAction(pageId: string) {
  await assertAdminAction();
  await updateMember(pageId, {
    inviteLink: null,
    inviteExpiresAt: null,
    lastBotCheckAt: isoDateTime(new Date()),
    lastBotMessage: "Invite fields cleared manually by admin",
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/member/${pageId}`);
}
