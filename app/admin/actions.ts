"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertAdminAction, clearAdminCookie, setAdminCookie } from "@/lib/auth";
import { getAdminPassword, getRuntimeConfig } from "@/lib/config";
import { addDays, isoDateTime } from "@/lib/dates";
import { getMemberByPageId, updateMember } from "@/lib/notion";
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

export async function markPaidAction(pageId: string) {
  await assertAdminAction();
  const now = new Date();
  const config = getRuntimeConfig();
  await updateMember(pageId, {
    status: "active_paid",
    paidAt: isoDateTime(now),
    reviewDueAt: isoDateTime(addDays(now, config.trialDays)),
    paymentDeadlineAt: null,
    renewalStep: "",
    renewalReminderSentAt: null,
    kickReason: "",
    lastBotCheckAt: isoDateTime(now),
    lastBotMessage: "Marked paid manually by admin",
  });
  const member = await getMemberByPageId(pageId);
  if (member?.telegramUserId) {
    await sendMessage(member.telegramUserId, "付款狀態已更新，你的會籍目前為有效狀態。");
  }
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
