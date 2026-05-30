import { isAdminAuthenticated } from "@/lib/auth";
import { getFile, telegramFileDownloadUrl } from "@/lib/telegram";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId");
  if (!fileId) {
    return new Response("Missing fileId", { status: 400 });
  }

  const telegramFile = await getFile(fileId);
  if (!telegramFile.file_path) {
    return new Response("Telegram file path not found", { status: 404 });
  }

  const response = await fetch(telegramFileDownloadUrl(telegramFile.file_path));
  if (!response.ok || !response.body) {
    return new Response("Unable to fetch Telegram file", { status: response.status });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": response.headers.get("content-type") || "application/octet-stream",
      "cache-control": "private, max-age=300",
    },
  });
}
