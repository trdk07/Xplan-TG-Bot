import { vi } from "vitest";
import { OperationStore, type OperationStorage } from "../src/store";
import { NotionBindingConflict } from "../src/notion";
import type { Config, Member, Services } from "../src/types";
export const now = Date.parse("2026-09-08T04:00:00Z"), userId = "111111111111111111";
export const config: Config = {
  applicationId: "222222222222222222", publicKey: "a".repeat(64), botToken: "test-only",
  guildId: "333333333333333333", trialRoleId: "444444444444444444", memberRoleId: "555555555555555555", nonExpiringRoleId: "555555555555555555",
  partnerRoleId: "666666666666666666",
  notionApiKey: "test-only", notionDataSourceId: "34f50abc-cc15-803c-bee1-000bfc6404cb", notionEmailProperty: "Email", notionDiscordIdProperty: "Discord_id",
  incompleteMemberPolicy: "trial", authSecret: "a-test-only-secret-that-is-long-enough", tierOverrides: {},
};
export const env = { DISCORD_APPLICATION_ID: config.applicationId, DISCORD_PUBLIC_KEY: config.publicKey, DISCORD_BOT_TOKEN: config.botToken,
  DISCORD_GUILD_ID: config.guildId, DISCORD_TRIAL_ROLE_ID: config.trialRoleId, DISCORD_MEMBER_ROLE_ID: config.memberRoleId,
  DISCORD_PARTNER_ROLE_ID: config.partnerRoleId,
  NOTION_API_KEY: config.notionApiKey, NOTION_DATA_SOURCE_ID: config.notionDataSourceId, AUTH_SECRET: config.authSecret };
export const member: Member = { pageId: "00000000-0000-4000-8000-000000000001", email: "member@example.com", exchangeId: "0012345678",
  status: "trial_active", dueAt: "2026-10-08T04:00:00Z", paidAt: null, paymentDeadlineAt: null, archived: false,
  discordId: null, credentialHash: null, tierProof: null, verifiedAt: null, discordRole: null };
export class MemoryOperations implements OperationStorage {
  values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> { return structuredClone(this.values.get(key)) as T | undefined; }
  async put<T>(key: string, value: T) { this.values.set(key, structuredClone(value)); }
  async delete(key: string) { return this.values.delete(key); }
  async list<T>({prefix}: {prefix:string}): Promise<Map<string,T>> { return new Map([...this.values].filter(([key]) => key.startsWith(prefix))) as Map<string,T>; }
}
export function fixture() {
  const storage = new MemoryOperations(), operations = new OperationStore(storage);
  const members = new Map<string, Member>([[member.pageId, { ...member }]]);
  const services: Services = {
    findMember: vi.fn(async (id, email) => { const matches = [...members.values()].filter(m => !m.archived && m.exchangeId === id && m.email === email); return matches.length === 1 ? { ...matches[0]! } : null; }),
    getMember: vi.fn(async id => { const found = members.get(id); if (!found) throw new Error("not found"); return { ...found }; }),
    findBinding: vi.fn(async id => { const matches = [...members.values()].filter(m => !m.archived && m.discordId === id); if (matches.length > 1) throw new NotionBindingConflict(); return matches.length ? { ...matches[0]! } : null; }),
    listBoundMembers: vi.fn(async () => [...members.values()].filter(m => !m.archived && m.discordId).map(m => ({ ...m }))),
    writeBinding: vi.fn(async (expected, binding) => { const m = members.get(expected.pageId)!; if (m.discordId && m.discordId !== binding.discordId) throw new NotionBindingConflict(); const updated = { ...m, ...binding }; members.set(m.pageId, updated); return { ...updated }; }),
    writeRole: vi.fn(async (expected, discordRole) => { const m = members.get(expected.pageId)!; if (m.discordId !== expected.discordId) throw new NotionBindingConflict(); members.set(m.pageId, { ...m, discordRole }); }),
    applyRoles: vi.fn(async () => "updated" as const), reply: vi.fn(async () => {}),
  };
  const change = (update: Partial<Member>) => members.set(member.pageId, { ...members.get(member.pageId)!, ...update });
  return { storage, operations, services, members, change };
}
export function notionPage(overrides: Partial<Member> = {}) {
  const value = { ...member, ...overrides };
  const date = (start: string | null) => ({ type: "date", date: start ? { start } : null });
  const text = (value: string | null) => ({ type: "rich_text", rich_text: value ? [{ plain_text: value }] : [] });
  return { object: "page", id: value.pageId, archived: value.archived, parent: { type: "data_source_id", data_source_id: config.notionDataSourceId },
    properties: { Email: { type: "email", email: value.email }, "Exchange UID": text(value.exchangeId), Discord_id: text(value.discordId),
      "Discord Role": { type: "select", select: value.discordRole ? { name: value.discordRole } : null },
      "Discord Credential Hash": text(value.credentialHash), "Discord Tier Proof": text(value.tierProof), "Discord Verified At": date(value.verifiedAt ? new Date(value.verifiedAt).toISOString() : null),
      Status: { type: "select", select: { name: value.status } }, "Review Due At": date(value.dueAt), "Paid At": date(value.paidAt), "Payment Deadline At": date(value.paymentDeadlineAt) } };
}
