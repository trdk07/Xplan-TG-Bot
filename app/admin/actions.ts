"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertAdminAction, clearAdminCookie, setAdminCookie } from "@/lib/auth";
import { sendRenewalReminder } from "@/lib/bot";
import { getAdminPassword, getRuntimeConfig } from "@/lib/config";
import {
  addDays,
  addMonths,
  daysUntil,
  formatDateTime,
  isoDateTime,
  renewalBaseDate,
} from "@/lib/dates";
import { getMemberByPageId, listMembers, updateMember } from "@/lib/notion";
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
  const member = await getMemberByPageId(pageId);
  if (!member) throw new Error("Member not found");
  if (!member.telegramUserId) throw new Error("Member has no Telegram User ID");

  const config = getRuntimeConfig();
  const deadline = addDays(now, config.paymentGraceDays);
  await updateMember(pageId, {
    status: "payment_pending",
    renewalStep: "payment_pending",
    paymentDeadlineAt: isoDateTime(deadline),
    paymentUidLast4: "",
    paymentProofFileId: "",
    paymentProofSubmittedAt: null,
    paidAt: null,
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Manual payment proof request sent by admin",
  });

  await sendMessage(
    member.telegramUserId,
    [
      "助理已開啟付款資料補傳流程。",
      "",
      "如果你已完成轉帳，請直接在這個 Bot 對話上傳轉帳截圖，並輸入 UID 末四碼（4 位數字）。",
      "",
      "若你尚未轉帳，請依照以下方式完成付款：",
      "",
      "續費方案：",
      "收費方式：",
      "3個月100U，一個月50U。（目前沒有年訂閱方案）",
      "",
      "可以使用交易所內部轉帳給小夏：",
      "MEXC - UID：77242747",
      "",
      "完成轉帳後，請上傳轉帳截圖，並在同一則訊息的文字說明或下一則訊息輸入 UID 末四碼。",
    ].join("\n"),
  );

  revalidatePath("/admin");
  revalidatePath(`/admin/member/${pageId}`);
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
