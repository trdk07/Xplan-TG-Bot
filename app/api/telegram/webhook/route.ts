import { getRuntimeConfig } from "@/lib/config";
import { handleTelegramUpdate } from "@/lib/bot";
import type { TelegramUpdate } from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = getRuntimeConfig();
  const secret = request.headers.get("x-telegram-bot-api-secret-token");

  if (secret !== config.telegramWebhookSecret) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  await handleTelegramUpdate(update);
  return Response.json({ ok: true });
}
