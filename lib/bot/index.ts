import type { TelegramUpdate } from "@/lib/telegram";
import { handleCallback } from "@/lib/bot/handlers/callback";
import { handleChatMember, handleJoinRequest } from "@/lib/bot/handlers/membership";
import { handleStart, handleUidMessage } from "@/lib/bot/handlers/start";
import { isStartCommand } from "@/lib/bot/utils";

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  now = new Date(),
) {
  if (update.message?.chat.type === "private") {
    if (isStartCommand(update.message.text)) {
      await handleStart(update.message, now);
    } else {
      await handleUidMessage(update.message, now);
    }
    return;
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query, now);
    return;
  }

  if (update.chat_join_request) {
    await handleJoinRequest(update.chat_join_request, now);
    return;
  }

  if (update.chat_member) {
    await handleChatMember(update.chat_member, now);
  }
}

export { exchanges, isStartCommand } from "@/lib/bot/utils";
export { paymentProofRequestKeyboard } from "@/lib/bot/keyboards";
export { manualPaymentProofRequestMessage } from "@/lib/bot/messages";
export { runDailyMembershipJob, sendRenewalReminder } from "@/lib/bot/daily-job";
