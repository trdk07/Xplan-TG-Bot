/** Private server-to-server contract. Never includes membership proofs or API tokens. */
export const ADMIN_PATH = "/internal/admin/member";
export type AdminRequest = {
  action: "sync" | "unlink";
  requestId: string;
  pageId: string;
  discordId: string;
  verifiedAt: number | null;
  operator: "Rick" | "小夏";
};
export type AdminFailure = {
  error: "binding_changed" | "rate_limited" | "operation_incomplete";
};
export type AdminResult = { action: AdminRequest["action"]; message: string };
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(
    value,
  );
export function parseAdminRequest(value: unknown): AdminRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).sort().join(",") !==
      "action,discordId,operator,pageId,requestId,verifiedAt" ||
    (r.action !== "sync" && r.action !== "unlink") ||
    !uuid(r.pageId) ||
    !uuid(r.requestId) ||
    typeof r.discordId !== "string" ||
    !/^\d{15,22}$/.test(r.discordId) ||
    (r.operator !== "Rick" && r.operator !== "小夏") ||
    (r.verifiedAt !== null &&
      (typeof r.verifiedAt !== "number" ||
        !Number.isFinite(r.verifiedAt) ||
        r.verifiedAt <= 0))
  )
    return null;
  return {
    action: r.action as AdminRequest["action"],
    requestId: r.requestId as string,
    pageId: r.pageId as string,
    discordId: r.discordId,
    verifiedAt: r.verifiedAt as number | null,
    operator: r.operator as AdminRequest["operator"],
  };
}
export function parseAdminResult(value: unknown): AdminResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  return Object.keys(r).sort().join(",") === "action,message" &&
    (r.action === "sync" || r.action === "unlink") &&
    typeof r.message === "string" &&
    r.message.length > 0 &&
    r.message.length <= 1000
    ? { action: r.action as AdminRequest["action"], message: r.message }
    : null;
}
export async function signAdminRequest(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}\nPOST\n${ADMIN_PATH}\n${body}`),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function verifyAdminRequest(
  secret: string,
  timestamp: string,
  signature: string,
  body: string,
  now = Date.now(),
) {
  if (
    secret.length < 32 ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const expected = await signAdminRequest(secret, timestamp, body);
  let difference = 0;
  for (let i = 0; i < 64; i++)
    difference |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
