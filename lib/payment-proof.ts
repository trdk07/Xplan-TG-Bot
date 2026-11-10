const IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
};

/** Image type from the Telegram file path; payment proofs are always images. */
export function proofContentType(filePath: string, upstream: string | null) {
  if (upstream?.startsWith("image/")) return upstream.split(";")[0];
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_TYPES[extension] ?? "image/jpeg";
}
