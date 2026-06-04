import { getRuntimeConfig } from "@/lib/config";
import { addDays } from "@/lib/dates";

export type MexcDirectSubaffiliate = {
  uid: string;
  depositAmount: string;
  raw: Record<string, any>;
};

function normalizeUid(value: string | number | null | undefined): string {
  return String(value || "").trim();
}

function numericString(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return "";
}

function recordUid(record: Record<string, any>): string {
  return normalizeUid(record.uid ?? record.subUid);
}

function recordDepositAmount(record: Record<string, any>): string {
  return numericString(
    record.depositAmount ??
      record.totalDepositAmount ??
      record.totalDeposit ??
      record.firstDepositAmount,
  );
}

function collectRecords(data: any): Array<Record<string, any>> {
  const candidates = [
    data?.data?.data,
    data?.data?.resultList,
    data?.data,
    data?.resultList,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function isMexcErrorResponse(data: any): boolean {
  if (data?.success === false) return true;
  if (data?.code === undefined || data?.code === null) return false;
  return ![0, 200, "0", "200"].includes(data.code);
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function mexcDepositMeetsMinimum(
  referral: MexcDirectSubaffiliate,
  minimumUsdt: number,
): boolean {
  const amount = Number.parseFloat(referral.depositAmount || "0");
  return Number.isFinite(amount) && amount >= minimumUsdt;
}

export async function getMexcDirectSubaffiliate(
  uid: string,
  now = new Date(),
): Promise<MexcDirectSubaffiliate | null> {
  const config = getRuntimeConfig();
  const normalizedUid = normalizeUid(uid);
  if (!normalizedUid) return null;
  if (!config.mexcApiAccessKey || !config.mexcApiSecretKey) {
    throw new Error("Missing MEXC API credentials");
  }

  const endTime = now.getTime();
  const startTime = addDays(now, -config.mexcAffiliateLookbackDays).getTime();
  const params = new URLSearchParams({
    [config.mexcAffiliateUidParam]: normalizedUid,
    startTime: String(startTime),
    endTime: String(endTime),
    timestamp: String(now.getTime()),
  });
  const signature = await hmacSha256Hex(
    config.mexcApiSecretKey,
    params.toString(),
  );
  params.set("signature", signature);

  const response = await fetch(
    `${config.mexcApiBaseUrl.replace(/\/$/, "")}${config.mexcAffiliateEndpoint}?${params.toString()}`,
    {
      headers: {
        "X-MEXC-APIKEY": config.mexcApiAccessKey,
        ...(config.mexcAffiliateMemberInfo
          ? { memberInfo: config.mexcAffiliateMemberInfo }
          : {}),
      },
    },
  );
  if (!response.ok) {
    throw new Error(`MEXC affiliate API failed with ${response.status}`);
  }

  const data = await response.json();
  if (isMexcErrorResponse(data)) {
    throw new Error(`MEXC affiliate API returned ${data.code}`);
  }

  const records = collectRecords(data);
  const matched = records.find((record) => recordUid(record) === normalizedUid);
  if (!matched) return null;

  return {
    uid: recordUid(matched),
    depositAmount: recordDepositAmount(matched),
    raw: matched,
  };
}
