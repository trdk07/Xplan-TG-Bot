import { getRuntimeConfig } from "@/lib/config";

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id?: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: {
    id: number;
    type: "private" | "group" | "supergroup" | "channel";
  };
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
};

export type TelegramChatJoinRequest = {
  chat: { id: number };
  from: TelegramUser;
  user_chat_id: number;
  date: number;
  invite_link?: {
    invite_link: string;
    name?: string;
    is_revoked?: boolean;
  };
};

export type TelegramChatMemberUpdated = {
  chat: { id: number };
  from: TelegramUser;
  date: number;
  old_chat_member: {
    status: string;
    user: TelegramUser;
  };
  new_chat_member: {
    status: string;
    user: TelegramUser;
  };
  invite_link?: {
    invite_link: string;
  };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  chat_join_request?: TelegramChatJoinRequest;
  chat_member?: TelegramChatMemberUpdated;
};

type TelegramApiResponse<T> =
  | { ok: true; result: T }
  | { ok: false; description?: string; error_code?: number };

async function telegramApi<T>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const config = getRuntimeConfig();
  const response = await fetch(
    `https://api.telegram.org/bot${config.telegramBotToken}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = (await response.json()) as TelegramApiResponse<T>;
  if (!data.ok) {
    throw new Error(data.description || `Telegram API ${method} failed`);
  }
  return data.result;
}

export type InlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

export async function sendMessage(
  chatId: string | number,
  text: string,
  keyboard?: InlineKeyboardButton[][],
) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboardButton[][],
) {
  return telegramApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

export async function getFile(fileId: string) {
  return telegramApi<{
    file_id: string;
    file_unique_id: string;
    file_path?: string;
  }>("getFile", { file_id: fileId });
}

export function telegramFileDownloadUrl(filePath: string): string {
  const config = getRuntimeConfig();
  return `https://api.telegram.org/file/bot${config.telegramBotToken}/${filePath}`;
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert = false,
) {
  return telegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  });
}

export async function createChatInviteLink(options: {
  name: string;
  expireDate: Date;
}) {
  const config = getRuntimeConfig();
  return telegramApi<{ invite_link: string }>("createChatInviteLink", {
    chat_id: config.telegramGroupId,
    name: options.name.slice(0, 32),
    expire_date: Math.floor(options.expireDate.getTime() / 1000),
    creates_join_request: true,
  });
}

export async function revokeChatInviteLink(inviteLink: string) {
  const config = getRuntimeConfig();
  return telegramApi("revokeChatInviteLink", {
    chat_id: config.telegramGroupId,
    invite_link: inviteLink,
  });
}

export async function approveChatJoinRequest(userId: number) {
  const config = getRuntimeConfig();
  return telegramApi("approveChatJoinRequest", {
    chat_id: config.telegramGroupId,
    user_id: userId,
  });
}

export async function declineChatJoinRequest(userId: number) {
  const config = getRuntimeConfig();
  return telegramApi("declineChatJoinRequest", {
    chat_id: config.telegramGroupId,
    user_id: userId,
  });
}

export async function banChatMember(userId: string | number) {
  const config = getRuntimeConfig();
  return telegramApi("banChatMember", {
    chat_id: config.telegramGroupId,
    user_id: Number(userId),
  });
}

export async function unbanChatMember(userId: string | number) {
  const config = getRuntimeConfig();
  return telegramApi("unbanChatMember", {
    chat_id: config.telegramGroupId,
    user_id: Number(userId),
    only_if_banned: true,
  });
}

export async function kickChatMember(userId: string | number) {
  await banChatMember(userId);
  await unbanChatMember(userId);
}
