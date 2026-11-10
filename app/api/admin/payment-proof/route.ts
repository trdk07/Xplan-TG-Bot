import { isAdminAuthenticated } from "@/lib/auth";
import { getFile, telegramFileDownloadUrl } from "@/lib/telegram";
import { proofContentType } from "@/lib/payment-proof";

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

  // Telegram serves files as application/octet-stream, which makes phones
  // download a nameless file. Name the real image type so it opens in place.
  const type = proofContentType(
    telegramFile.file_path,
    response.headers.get("content-type"),
  );
  const extension = type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": type,
      "content-disposition": `inline; filename="payment-proof.${extension}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
    },
  });
}
