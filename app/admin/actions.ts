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
  daysUntil,
  formatDateTime,
  isoDateTime,
  renewalBaseDate,
} from "@/lib/dates";
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

  const baseDate = renewalBaseDate(member.reviewDueAt, now);
  const reviewDueAt = addMonths(baseDate, durationMonths);
  await updateMember(pageId, {
    status: "active_paid",
    paidAt: isoDateTime(now),
    reviewDueAt: isoDateTime(reviewDueAt),
    paymentDeadlineAt: null,
    renewalStep: "",
    renewalReminderSentAt: null,
    kickReason: "",
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: `Marked paid manually by admin (${durationMonths} month${durationMonths > 1 ? "s" : ""})`,
  });
  if (member.telegramUserId) {
    await sendMessage(
      member.telegramUserId,
      `付款狀態已更新，你的會籍目前為有效狀態，有效期限至 ${formatDateTime(
        isoDateTime(reviewDueAt),
      )}。`,
    );
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
    const days = daysUntil(member.reviewDueAt, now);
    const shouldResend =
      Boolean(member.telegramUserId) &&
      (member.status === "trial_active" || member.status === "active_paid") &&
      days !== null &&
      days >= 0 &&
      days <= 7;

    if (shouldResend) {
      await sendRenewalReminder(
        member,
        now,
        "Renewal reminder resent manually by admin",
      );
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
