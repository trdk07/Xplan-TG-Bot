import { Client } from "@notionhq/client";
import { getRuntimeConfig } from "@/lib/config";
import { type MemberStatus, isMemberStatus, memberStatuses } from "@/lib/status";

export type Member = {
  pageId: string;
  telegramUserId: string;
  telegramUsername: string;
  status: MemberStatus;
  tags: string[];
  exchangeRegistered: boolean;
  exchangeName: string;
  exchangeUid: string;
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
  finalPnl: string;
  renewalStep: string;
  renewalReminderSentAt: string | null;
  lastBotCheckAt: string | null;
  lastBotMessage: string;
  kickReason: string;
};

export type MemberPatch = Partial<
  Omit<Member, "pageId" | "telegramUserId"> & {
    telegramUserId: string;
  }
>;

export const notionProperties = {
  telegramUserId: "Telegram User ID",
  telegramUsername: "Telegram Username",
  status: "Status",
  tags: "Tags",
  exchangeRegistered: "Exchange Registered",
  exchangeName: "Exchange Name",
  exchangeUid: "Exchange UID",
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
  finalPnl: "Final P/L",
  renewalStep: "Renewal Step",
  renewalReminderSentAt: "Renewal Reminder Sent At",
  lastBotCheckAt: "Last Bot Check At",
  lastBotMessage: "Last Bot Message",
  kickReason: "Kick Reason",
} as const;

const legacyProperties = {
  telegramUsername: "TG 帳號",
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

function textProp(page: NotionPage, name: string): string {
  const prop = page.properties[name];
  if (!prop) return "";
  if (Array.isArray(prop.rich_text)) {
    return prop.rich_text.map((item: any) => item.plain_text || "").join("");
  }
  if (Array.isArray(prop.title)) {
    return prop.title.map((item: any) => item.plain_text || "").join("");
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
    status: statusProp(page),
    tags: multiSelectProp(page, notionProperties.tags),
    exchangeRegistered: checkboxProp(page, notionProperties.exchangeRegistered),
    exchangeName: textProp(page, notionProperties.exchangeName),
    exchangeUid: textProp(page, notionProperties.exchangeUid),
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
    finalPnl: textProp(page, notionProperties.finalPnl),
    renewalStep: selectProp(page, notionProperties.renewalStep),
    renewalReminderSentAt: dateProp(page, notionProperties.renewalReminderSentAt),
    lastBotCheckAt: dateProp(page, notionProperties.lastBotCheckAt),
    lastBotMessage: textProp(page, notionProperties.lastBotMessage),
    kickReason: textProp(page, notionProperties.kickReason),
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
    props[notionProperties.exchangeName] = richText(patch.exchangeName);
  }
  if (patch.exchangeUid !== undefined) {
    props[notionProperties.exchangeUid] = richText(patch.exchangeUid);
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

  return props;
}

export async function updateMember(pageId: string, patch: MemberPatch) {
  await notion().pages.update({
    page_id: pageId,
    properties: buildNotionProperties(patch),
  });
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
