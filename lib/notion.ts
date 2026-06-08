import { Client } from "@notionhq/client";
import { getRuntimeConfig } from "@/lib/config";
import { type MemberStatus, isMemberStatus, memberStatuses } from "@/lib/status";

export type Member = {
  pageId: string;
  telegramUserId: string;
  telegramUsername: string;
  email: string;
  status: MemberStatus;
  tags: string[];
  exchangeRegistered: boolean;
  exchangeName: string;
  exchangeUid: string;
  invitationEmailSent: boolean;
  uidSubmittedAt: string | null;
  inviteLink: string | null;
  inviteExpiresAt: string | null;
  groupJoinedAt: string | null;
  reviewDueAt: string | null;
  paymentDeadlineAt: string | null;
  paymentUidLast4: string;
  paymentProofFileId: string;
  paymentProofSubmittedAt: string | null;
  paidAt: string | null;
  subscriptionMonths: number | null;
  finalPnl: string;
  renewalStep: string;
  renewalReminderSentAt: string | null;
  lastBotCheckAt: string | null;
  lastBotMessage: string;
  kickReason: string;
  tradingView: string;
  tradingViewAccess: string;
};

export type MemberPatch = Partial<
  Omit<Member, "pageId" | "telegramUserId"> & {
    telegramUserId: string;
  }
>;

export const notionProperties = {
  telegramUserId: "Telegram User ID",
  telegramUsername: "Telegram Username",
  email: "email",
  status: "Status",
  tags: "Tags",
  exchangeRegistered: "Exchange Registered",
  exchangeName: "Exchange Name",
  exchangeUid: "Exchange UID",
  invitationEmailSent: "已送出邀請",
  uidSubmittedAt: "UID Submitted At",
  inviteLink: "Invite Link",
  inviteExpiresAt: "Invite Expires At",
  groupJoinedAt: "Group Joined At",
  reviewDueAt: "Review Due At",
  paymentDeadlineAt: "Payment Deadline At",
  paymentUidLast4: "Payment UID Last 4",
  paymentProofFileId: "Payment Proof File ID",
  paymentProofSubmittedAt: "Payment Proof Submitted At",
  paidAt: "Paid At",
  subscriptionMonths: "Subscription Months",
  finalPnl: "Final P/L",
  renewalStep: "Renewal Step",
  renewalReminderSentAt: "Renewal Reminder Sent At",
  lastBotCheckAt: "Last Bot Check At",
  lastBotMessage: "Last Bot Message",
  kickReason: "Kick Reason",
  tradingView: "TradingView",
  tradingViewAccess: "TradingView Access",
} as const;

const legacyProperties = {
  telegramUsername: "TG 帳號",
  email: ["Email", "email", "E-mail", "電子郵件", "信箱", "Respondent Email"],
} as const;

type NotionPage = {
  id: string;
  properties: Record<string, any>;
};

let client: Client | null = null;

function notion() {
  if (!client) {
    client = new Client({ auth: getRuntimeConfig().notionApiKey });
  }
  return client;
}

function richText(value: string | null | undefined) {
  return {
    rich_text: value ? [{ type: "text", text: { content: value } }] : [],
  };
}

function titleText(value: string | null | undefined) {
  return {
    title: value ? [{ type: "text", text: { content: value } }] : [],
  };
}

function dateValue(value: string | null | undefined) {
  return { date: value ? { start: value } : null };
}

function valueFromTextLikeProp(prop: any): string {
  if (!prop) return "";
  if (typeof prop.email === "string") return prop.email;
  if (typeof prop.phone_number === "string") return prop.phone_number;
  if (typeof prop.url === "string") return prop.url;
  if (prop.type === "email" && typeof prop.email === "string") return prop.email;
  if (Array.isArray(prop.rich_text)) {
    return prop.rich_text.map((item: any) => item.plain_text || "").join("");
  }
  if (Array.isArray(prop.title)) {
    return prop.title.map((item: any) => item.plain_text || "").join("");
  }
  return "";
}

function textProp(page: NotionPage, name: string): string {
  return valueFromTextLikeProp(page.properties[name]);
}

function firstTextProp(page: NotionPage, names: readonly string[]): string {
  for (const name of names) {
    const value = textProp(page, name);
    if (value) return value;
  }
  return "";
}

function dateProp(page: NotionPage, name: string): string | null {
  return page.properties[name]?.date?.start || null;
}

function checkboxProp(page: NotionPage, name: string): boolean {
  return Boolean(page.properties[name]?.checkbox);
}

function urlProp(page: NotionPage, name: string): string | null {
  return page.properties[name]?.url || null;
}

function statusProp(page: NotionPage): MemberStatus {
  const raw = page.properties[notionProperties.status]?.select?.name;
  return isMemberStatus(raw) ? raw : "eligible";
}

function selectProp(page: NotionPage, name: string): string {
  return page.properties[name]?.select?.name || textProp(page, name);
}

function multiSelectProp(page: NotionPage, name: string): string[] {
  const prop = page.properties[name];
  if (!Array.isArray(prop?.multi_select)) return [];
  return prop.multi_select
    .map((item: any) => item.name || "")
    .filter(Boolean);
}

export function mapNotionPageToMember(page: NotionPage): Member {
  return {
    pageId: page.id,
    telegramUserId: textProp(page, notionProperties.telegramUserId),
    telegramUsername:
      textProp(page, notionProperties.telegramUsername) ||
      textProp(page, legacyProperties.telegramUsername),
    email:
      textProp(page, notionProperties.email) ||
      firstTextProp(page, legacyProperties.email),
    status: statusProp(page),
    tags: multiSelectProp(page, notionProperties.tags),
    exchangeRegistered: checkboxProp(page, notionProperties.exchangeRegistered),
    exchangeName: selectProp(page, notionProperties.exchangeName),
    exchangeUid: textProp(page, notionProperties.exchangeUid),
    invitationEmailSent: checkboxProp(page, notionProperties.invitationEmailSent),
    uidSubmittedAt: dateProp(page, notionProperties.uidSubmittedAt),
    inviteLink: urlProp(page, notionProperties.inviteLink),
    inviteExpiresAt: dateProp(page, notionProperties.inviteExpiresAt),
    groupJoinedAt: dateProp(page, notionProperties.groupJoinedAt),
    reviewDueAt: dateProp(page, notionProperties.reviewDueAt),
    paymentDeadlineAt: dateProp(page, notionProperties.paymentDeadlineAt),
    paymentUidLast4: textProp(page, notionProperties.paymentUidLast4),
    paymentProofFileId: textProp(page, notionProperties.paymentProofFileId),
    paymentProofSubmittedAt: dateProp(page, notionProperties.paymentProofSubmittedAt),
    paidAt: dateProp(page, notionProperties.paidAt),
    subscriptionMonths: (() => {
      const n = page.properties[notionProperties.subscriptionMonths]?.number;
      if (n != null) return n;
      const msg = textProp(page, notionProperties.lastBotMessage);
      const m = msg.match(/\((\d+) months?\)/);
      return m ? parseInt(m[1], 10) : null;
    })(),
    finalPnl: textProp(page, notionProperties.finalPnl),
    renewalStep: selectProp(page, notionProperties.renewalStep),
    renewalReminderSentAt: dateProp(page, notionProperties.renewalReminderSentAt),
    lastBotCheckAt: dateProp(page, notionProperties.lastBotCheckAt),
    lastBotMessage: textProp(page, notionProperties.lastBotMessage),
    kickReason: textProp(page, notionProperties.kickReason),
    tradingView: textProp(page, notionProperties.tradingView),
    tradingViewAccess: selectProp(page, notionProperties.tradingViewAccess),
  };
}

export function normalizeTelegramUsername(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^t\.me\//i, "")
    .replace(/^@/, "")
    .split(/[/?#\s]/)[0]
    .toLowerCase();
}

export function normalizeExchangeUid(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

export function buildNotionProperties(patch: MemberPatch): Record<string, any> {
  const props: Record<string, any> = {};

  if (patch.telegramUserId !== undefined) {
    props[notionProperties.telegramUserId] = richText(patch.telegramUserId);
  }
  if (patch.telegramUsername !== undefined) {
    props[notionProperties.telegramUsername] = titleText(patch.telegramUsername);
  }
  if (patch.email !== undefined) {
    props[notionProperties.email] = { email: patch.email || null };
  }
  if (patch.status !== undefined) {
    props[notionProperties.status] = { select: { name: patch.status } };
  }
  if (patch.tags !== undefined) {
    props[notionProperties.tags] = {
      multi_select: patch.tags.map((name) => ({ name })),
    };
  }
  if (patch.exchangeRegistered !== undefined) {
    props[notionProperties.exchangeRegistered] = {
      checkbox: patch.exchangeRegistered,
    };
  }
  if (patch.exchangeName !== undefined) {
    props[notionProperties.exchangeName] = { select: patch.exchangeName ? { name: patch.exchangeName } : null };
  }
  if (patch.exchangeUid !== undefined) {
    props[notionProperties.exchangeUid] = richText(patch.exchangeUid);
  }
  if (patch.invitationEmailSent !== undefined) {
    props[notionProperties.invitationEmailSent] = {
      checkbox: patch.invitationEmailSent,
    };
  }
  if (patch.uidSubmittedAt !== undefined) {
    props[notionProperties.uidSubmittedAt] = dateValue(patch.uidSubmittedAt);
  }
  if (patch.inviteLink !== undefined) {
    props[notionProperties.inviteLink] = { url: patch.inviteLink };
  }
  if (patch.inviteExpiresAt !== undefined) {
    props[notionProperties.inviteExpiresAt] = dateValue(patch.inviteExpiresAt);
  }
  if (patch.groupJoinedAt !== undefined) {
    props[notionProperties.groupJoinedAt] = dateValue(patch.groupJoinedAt);
  }
  if (patch.reviewDueAt !== undefined) {
    props[notionProperties.reviewDueAt] = dateValue(patch.reviewDueAt);
  }
  if (patch.paymentDeadlineAt !== undefined) {
    props[notionProperties.paymentDeadlineAt] = dateValue(
      patch.paymentDeadlineAt,
    );
  }
  if (patch.paymentUidLast4 !== undefined) {
    props[notionProperties.paymentUidLast4] = richText(patch.paymentUidLast4);
  }
  if (patch.paymentProofFileId !== undefined) {
    props[notionProperties.paymentProofFileId] = richText(
      patch.paymentProofFileId,
    );
  }
  if (patch.paymentProofSubmittedAt !== undefined) {
    props[notionProperties.paymentProofSubmittedAt] = dateValue(
      patch.paymentProofSubmittedAt,
    );
  }
  if (patch.paidAt !== undefined) {
    props[notionProperties.paidAt] = dateValue(patch.paidAt);
  }
  if (patch.subscriptionMonths !== undefined) {
    props[notionProperties.subscriptionMonths] = { number: patch.subscriptionMonths };
  }
  if (patch.finalPnl !== undefined) {
    props[notionProperties.finalPnl] = richText(patch.finalPnl);
  }
  if (patch.renewalStep !== undefined) {
    props[notionProperties.renewalStep] = {
      select: patch.renewalStep ? { name: patch.renewalStep } : null,
    };
  }
  if (patch.renewalReminderSentAt !== undefined) {
    props[notionProperties.renewalReminderSentAt] = dateValue(
      patch.renewalReminderSentAt,
    );
  }
  if (patch.lastBotCheckAt !== undefined) {
    props[notionProperties.lastBotCheckAt] = dateValue(patch.lastBotCheckAt);
  }
  if (patch.lastBotMessage !== undefined) {
    props[notionProperties.lastBotMessage] = richText(patch.lastBotMessage);
  }
  if (patch.kickReason !== undefined) {
    props[notionProperties.kickReason] = richText(patch.kickReason);
  }
  if (patch.tradingViewAccess !== undefined) {
    props[notionProperties.tradingViewAccess] = {
      select: patch.tradingViewAccess ? { name: patch.tradingViewAccess } : null,
    };
  }

  return props;
}

async function existingNotionProperties(
  pageId: string,
  patch: MemberPatch,
): Promise<Record<string, any>> {
  const page = (await notion().pages.retrieve({ page_id: pageId })) as NotionPage;
  const existingProperties = page.properties || {};
  return Object.fromEntries(
    Object.entries(buildNotionProperties(patch)).filter(([name]) =>
      Object.prototype.hasOwnProperty.call(existingProperties, name),
    ),
  );
}

export async function updateMember(pageId: string, patch: MemberPatch) {
  const properties = buildNotionProperties(patch);
  try {
    await notion().pages.update({
      page_id: pageId,
      properties,
    });
  } catch (error) {
    const fallbackProperties = await existingNotionProperties(pageId, patch);
    if (Object.keys(fallbackProperties).length === Object.keys(properties).length) {
      throw error;
    }
    if (!Object.keys(fallbackProperties).length) return;
    await notion().pages.update({
      page_id: pageId,
      properties: fallbackProperties,
    });
  }
}

export async function updateMemberExistingProperties(
  pageId: string,
  patch: MemberPatch,
): Promise<string[]> {
  const properties = await existingNotionProperties(pageId, patch);

  if (!Object.keys(properties).length) return [];

  await notion().pages.update({
    page_id: pageId,
    properties,
  });
  return Object.keys(properties);
}

export async function getMemberByPageId(pageId: string): Promise<Member | null> {
  const page = (await notion().pages.retrieve({ page_id: pageId })) as NotionPage;
  if (!page?.properties) return null;
  return mapNotionPageToMember(page);
}

export async function findMemberByTelegramId(
  telegramUserId: string,
): Promise<Member | null> {
  const config = getRuntimeConfig();
  const response = await notion().dataSources.query({
    data_source_id: config.notionDataSourceId,
    page_size: 1,
    filter: {
      property: notionProperties.telegramUserId,
      rich_text: { equals: telegramUserId },
    },
  } as any);
  const first = (response.results[0] as NotionPage | undefined) || null;
  return first ? mapNotionPageToMember(first) : null;
}

export async function findMemberByTelegramUsername(
  telegramUsername: string | null | undefined,
): Promise<Member | null> {
  const normalized = normalizeTelegramUsername(telegramUsername);
  if (!normalized) return null;

  const members = await listMembers({ limit: 1000 });
  return (
    members.find(
      (member) => normalizeTelegramUsername(member.telegramUsername) === normalized,
    ) || null
  );
}

export async function findMemberByExchangeUid(
  exchangeName: string,
  exchangeUid: string,
): Promise<Member | null> {
  const normalizedExchangeName = exchangeName.trim().toLowerCase();
  const normalizedUid = normalizeExchangeUid(exchangeUid);
  if (!normalizedExchangeName || !normalizedUid) return null;

  const members = await listMembers({ limit: 1000 });
  return (
    members.find(
      (member) =>
        member.exchangeName.trim().toLowerCase() === normalizedExchangeName &&
        normalizeExchangeUid(member.exchangeUid) === normalizedUid,
    ) || null
  );
}

export async function listMembers(options?: {
  status?: MemberStatus | "all";
  query?: string;
  limit?: number;
}): Promise<Member[]> {
  const config = getRuntimeConfig();
  const members: Member[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion().dataSources.query({
      data_source_id: config.notionDataSourceId,
      page_size: Math.min(options?.limit || 100, 100),
      start_cursor: cursor,
    } as any);

    members.push(
      ...(response.results as NotionPage[]).map((page) =>
        mapNotionPageToMember(page),
      ),
    );
    cursor = response.has_more ? response.next_cursor || undefined : undefined;
  } while (cursor && (!options?.limit || members.length < options.limit));

  const status = options?.status;
  const statusFiltered =
    status && status !== "all" && memberStatuses.includes(status)
      ? members.filter((member) => member.status === status)
      : members;

  const query = options?.query?.trim().toLowerCase();
  const filtered = query
    ? statusFiltered.filter((member) =>
        [
          member.telegramUserId,
          member.telegramUsername,
          member.email,
          member.exchangeName,
          member.exchangeUid,
          member.tags.join(" "),
          member.finalPnl,
          member.renewalStep,
          member.status,
          member.kickReason,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    : statusFiltered;

  return filtered.slice(0, options?.limit || filtered.length);
}
