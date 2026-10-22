import type { TelegramMessage } from "@/lib/telegram";

export const exchanges = {
  MEXC: {
    name: "MEXC",
    url: "https://www.mexc.com/zh-TW/acquisition/custom-sign-up?shareCode=mexc-Xplan",
  },
  BitMart: {
    name: "BitMart",
    url: "https://www.bitmart.com/zh-TW/invite/cMPDb9",
  },
} as const;

export function userId(value: number): string {
  return String(value);
}

export function usernameFromMessage(message: TelegramMessage): string {
  return message.from?.username ? `@${message.from.username}` : "";
}

export function isStartCommand(text: string | undefined): boolean {
  if (!text) return false;
  const [command] = text.trim().split(/\s+/, 1);
  return /^\/start(?:@[A-Za-z0-9_]+)?$/i.test(command || "");
}

export function mexcUidFromMessage(message: TelegramMessage): string {
  const text = (message.text || message.caption || "").trim();
  return text.match(/\d{5,}/)?.[0] || "";
}
