export type RuntimeConfig = {
  telegramBotToken: string;
  telegramWebhookSecret: string;
  telegramGroupId: string;
  notionApiKey: string;
  notionDataSourceId: string;
  adminPassword: string;
  appBaseUrl: string;
  exchangeName: string;
  teacherTelegramUid: string;
  trialDays: number;
  paymentGraceDays: number;
  jobSecret: string | null;
  mexcApiBaseUrl: string;
  mexcApiAccessKey: string | null;
  mexcApiSecretKey: string | null;
  mexcAffiliateEndpoint: string;
  mexcAffiliateUidParam: string;
  mexcAffiliateMemberInfo: string | null;
  mexcAffiliateLookbackDays: number;
  mexcMinDepositUsdt: number;
};

const requiredKeys = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_GROUP_ID",
  "NOTION_API_KEY",
  "NOTION_DATA_SOURCE_ID",
  "ADMIN_PASSWORD",
  "APP_BASE_URL",
] as const;

function requireEnv(name: (typeof requiredKeys)[number]): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getRuntimeConfig(): RuntimeConfig {
  return {
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    telegramWebhookSecret: requireEnv("TELEGRAM_WEBHOOK_SECRET"),
    telegramGroupId: requireEnv("TELEGRAM_GROUP_ID"),
    notionApiKey: requireEnv("NOTION_API_KEY"),
    notionDataSourceId: requireEnv("NOTION_DATA_SOURCE_ID"),
    adminPassword: requireEnv("ADMIN_PASSWORD"),
    appBaseUrl: requireEnv("APP_BASE_URL").replace(/\/$/, ""),
    exchangeName: process.env.EXCHANGE_NAME || "X-Plan",
    teacherTelegramUid: process.env.TEACHER_TG_UID || "1222518302",
    trialDays: intEnv("TRIAL_DAYS", 30),
    paymentGraceDays: intEnv("PAYMENT_GRACE_DAYS", 3),
    jobSecret: process.env.JOB_SECRET || null,
    mexcApiBaseUrl: process.env.MEXC_API_BASE_URL || "https://api.mexc.com",
    mexcApiAccessKey: process.env.MEXC_API_ACCESS_KEY || null,
    mexcApiSecretKey: process.env.MEXC_API_SECRET_KEY || null,
    mexcAffiliateEndpoint:
      process.env.MEXC_AFFILIATE_ENDPOINT || "/api/v3/rebate/affiliate/referral",
    mexcAffiliateUidParam: process.env.MEXC_AFFILIATE_UID_PARAM || "uid",
    mexcAffiliateMemberInfo: process.env.MEXC_AFFILIATE_MEMBER_INFO || null,
    mexcAffiliateLookbackDays: intEnv("MEXC_AFFILIATE_LOOKBACK_DAYS", 365),
    mexcMinDepositUsdt: intEnv("MEXC_MIN_DEPOSIT_USDT", 100),
  };
}

export function getAdminPassword(): string {
  const value = process.env.ADMIN_PASSWORD;
  if (!value) {
    throw new Error("Missing required environment variable: ADMIN_PASSWORD");
  }
  return value;
}

export function getMissingConfig(): string[] {
  return requiredKeys.filter((key) => !process.env[key]);
}

export function getDisplayConfig() {
  return {
    telegramGroupId: process.env.TELEGRAM_GROUP_ID || "",
    notionDataSourceId: process.env.NOTION_DATA_SOURCE_ID || "",
    appBaseUrl: process.env.APP_BASE_URL || "",
    exchangeName: process.env.EXCHANGE_NAME || "Your Exchange",
    teacherTelegramUid: process.env.TEACHER_TG_UID || "1222518302",
    trialDays: intEnv("TRIAL_DAYS", 30),
    paymentGraceDays: intEnv("PAYMENT_GRACE_DAYS", 3),
    hasJobSecret: Boolean(process.env.JOB_SECRET),
    hasMexcApiAccessKey: Boolean(process.env.MEXC_API_ACCESS_KEY),
    hasMexcApiSecretKey: Boolean(process.env.MEXC_API_SECRET_KEY),
  };
}
