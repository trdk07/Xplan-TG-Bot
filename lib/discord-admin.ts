import {
  ADMIN_PATH,
  parseAdminRequest,
  parseAdminResult,
  signAdminRequest,
  type AdminRequest,
  type AdminResult,
} from "@/shared/discord-admin-protocol";
export type DiscordAdminState = {
  kind: "idle" | "success" | "error";
  message: string;
};
export class DiscordAdminError extends Error {}
type Environment = Record<string, string | undefined>;
function settings(env: Environment) {
  const secret = env.DISCORD_ADMIN_API_SECRET;
  const raw = env.DISCORD_ADMIN_API_URL;
  if (!secret || secret.length < 32 || !raw)
    throw new DiscordAdminError("尚未設定 DC 管理連線，請由管理者完成設定。");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DiscordAdminError("DC 管理連線網址設定無效。");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw new DiscordAdminError(
      "DC 管理連線須使用不含帳密或路徑的 HTTPS 網址。",
    );
  return { url: url.origin + ADMIN_PATH, secret };
}
export function isDiscordAdminConfigured(env: Environment = process.env) {
  try {
    settings(env);
    return true;
  } catch {
    return false;
  }
}
export async function runDiscordAdmin(
  input: AdminRequest,
  options: {
    environment?: Environment;
    fetcher?: typeof fetch;
    now?: number;
  } = {},
): Promise<AdminResult> {
  const request = parseAdminRequest(input);
  if (!request)
    throw new DiscordAdminError("DC 操作資料無效，請重新整理會員頁面。");
  const { url, secret } = settings(options.environment || process.env);
  const body = JSON.stringify(request);
  const timestamp = String(Math.floor((options.now ?? Date.now()) / 1000));
  let response: Response;
  try {
    response = await (options.fetcher || fetch)(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        "X-Xplan-Admin-Timestamp": timestamp,
        "X-Xplan-Admin-Signature": await signAdminRequest(
          secret,
          timestamp,
          body,
        ),
      },
      body,
    });
  } catch {
    throw new DiscordAdminError(
      "DC 操作尚未確認完成，請重新整理查看結果；若已建立解除待辦，Bot 會繼續處理。",
    );
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 404)
      throw new DiscordAdminError("DC 管理連線驗證失敗，請檢查兩端設定。");
    if (response.status === 409)
      throw new DiscordAdminError(
        "綁定資料已變更或需要覆核，請重新整理會員頁面後確認。",
      );
    if (response.status === 429)
      throw new DiscordAdminError("DC 管理操作較多，請稍後重試。");
    throw new DiscordAdminError(
      "DC 操作尚未確認完成，請重新整理查看結果；若已建立解除待辦，Bot 會繼續處理。",
    );
  }
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    let size = 0,
      text = "";
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Error();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    const result = parseAdminResult(JSON.parse(text + decoder.decode()));
    if (!result || result.action !== request.action) throw new Error();
    return result;
  } catch {
    throw new DiscordAdminError(
      "DC 回覆無法確認，請重新整理會員頁面查看紀錄。",
    );
  }
}
export const requestDiscordAdmin = (request: AdminRequest) =>
  runDiscordAdmin(request);
