export type Exchange = "mexc" | "bitget" | "okx";
export type Tier = "trial" | "paid" | "non_expiring" | "partner" | "explorer" | "volume";
export interface Config {
  membershipPolicyV2Enabled?: boolean;
  applicationId: string;
  publicKey: string;
  botToken: string;
  guildId: string;
  trialRoleId: string;
  memberRoleId: string;
  partnerRoleId: string;
  nonExpiringRoleId: string;
  notionApiKey: string;
  notionDataSourceId: string;
  notionEmailProperty: string;
  notionDiscordIdProperty: string;
  incompleteMemberPolicy: "trial" | "review";
  authSecret: string;
  tierOverrides: Record<string, "trial" | "paid">;
}
export interface Member {
  pageId: string;
  discordId: string | null;
  credentialHash: string | null;
  tierProof: string | null;
  verifiedAt: number | null;
  discordRole?: string | null;
  email: string;
  exchangeId: string;
  exchange?: Exchange | null;
  admissionVerifiedAt?: string | null;
  volumeQualified?: boolean;
  volumeCheckedAt?: string | null;
  volumeCheckError?: string | null;
  status: string;
  dueAt: string | null;
  paidAt: string | null;
  paymentDeadlineAt: string | null;
  archived: boolean;
}
export interface Binding {
  discordId: string;
  pageId: string;
  credentialHash: string;
  tier: Tier | null;
  dueAt: string | null;
  paidAt: string | null;
  verifiedAt: number;
}
export type Decision =
  | { state: "allow"; tier: Tier; dueAt: string | null }
  | { state: "deny"; reason: "expired" | "blocked" | "not_active" }
  | { state: "review"; reason: "unknown_status" | "invalid_date" | "ambiguous_tier" };
export interface BindingWrite {
  discordId: string;
  pageId: string;
  credentialHash: string;
  tierProof: string | null;
  verifiedAt: number;
}
export interface Interaction {
  id: string;
  application_id: string;
  type: number;
  guild_id?: string;
  token: string;
  member?: { user?: { id: string }; pending?: boolean };
  data?: {
    name?: string;
    custom_id?: string;
    components?: Component[];
  };
}
export interface Component { type: number; custom_id?: string; value?: string; values?: string[]; components?: Component[]; component?: Component }
export interface MessageBody {
  content: string;
  components?: unknown[];
  allowed_mentions?: { parse: string[] };
}
export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface GuildMember { discordId: string; roles: string[]; bot: boolean; pending: boolean }
export interface GuildPage { members: GuildMember[]; next: string | null }
export type RoleResult = "updated" | "not_in_guild" | "screening_pending";
export interface Services {
  listGuildMembers?(after: string): Promise<GuildPage>;
  applyDefaultExplorer?(discordId: string): Promise<RoleResult | "skipped">;
  findMember(exchangeId: string, email: string, exchange?: Exchange): Promise<Member | null>;
  getMember(pageId: string): Promise<Member>;
  findBinding(discordId: string): Promise<Member | null>;
  listBoundMembers(): Promise<Member[]>;
  writeBinding(member: Member, binding: BindingWrite): Promise<Member>;
  writeRole(member: Member, role: string | null): Promise<void>;
  applyRoles(discordId: string, decision: Decision): Promise<"updated" | "not_in_guild" | "screening_pending">;
  reply(interaction: Interaction, message: MessageBody): Promise<void>;
}
