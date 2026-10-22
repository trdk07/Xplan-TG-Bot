import { isDiscordId, pageKey } from "./config";
import { normalizeEmail, normalizeExchangeId } from "./membership";
import type { BindingWrite, Config, Fetcher, Member } from "./types";
type Text = { plain_text?: string; text?: { content?: string } };
type Property = { type?: string; email?: string | null; select?: { name?: string } | null; date?: { start?: string } | null; rich_text?: Text[]; title?: Text[] };
interface Page {
  object: string; id: string; archived?: boolean; in_trash?: boolean;
  parent?: { data_source_id?: string; database_id?: string };
  properties?: Record<string, Property>;
}
export class UpstreamError extends Error {
  constructor(public readonly service: string, public readonly status = 0) { super(`${service} unavailable (${status})`); }
}
export class NotionBindingConflict extends UpstreamError {
  constructor() { super("notion-binding-conflict"); }
}
export async function timedFetch(fetcher: Fetcher, url: string, init: RequestInit = {}): Promise<Response> {
  // Workers supports only follow/manual. Callers reject non-2xx responses,
  // so manual also prevents credentials from following a redirected request.
  try { return await fetcher(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: "manual" }); }
  catch { throw new UpstreamError("network"); }
}
export const verificationProperties = { verifiedAt: "Discord Verified At", credentialHash: "Discord Credential Hash", tierProof: "Discord Tier Proof" } as const;
export const discordRoleProperty = "Discord Role";
export class NotionClient {
  private nextRequest = 0;
  constructor(private config: Config, private fetcher: Fetcher = fetch) {}
  private async request(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<unknown> {
    // Limit this instance's Notion calls to fewer than three per second.
    const reserved = Math.max(Date.now(), this.nextRequest);
    this.nextRequest = reserved + 350;
    if (reserved > Date.now()) await new Promise((resolve) => setTimeout(resolve, reserved - Date.now()));
    const response = await timedFetch(this.fetcher, `https://api.notion.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.config.notionApiKey}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new UpstreamError("notion", response.status);
    try { return await response.json(); } catch { throw new UpstreamError("notion"); }
  }
  private member(page: Page): Member {
    if (page.object !== "page" || !page.properties || !page.parent?.data_source_id || pageKey(page.parent.data_source_id) !== pageKey(this.config.notionDataSourceId)) throw new UpstreamError("notion-schema");
    const properties = page.properties;
    // Reject a renamed/mistyped Status field instead of assuming eligibility.
    const status = properties.Status?.type === "select" ? properties.Status.select?.name || "" : "";
    const discord = properties[this.config.notionDiscordIdProperty];
    if (discord?.type !== "rich_text" || !Array.isArray(discord.rich_text)) throw new UpstreamError("notion-discord-id-schema");
    const discordId = discord.rich_text.map((text) => text.plain_text ?? text.text?.content ?? "").join("").trim();
    return {
      discordId: discordId || null,
      // A missing/mistyped result column must not prevent expiry revocation.
      discordRole: properties[discordRoleProperty]?.type === "select" ? properties[discordRoleProperty]?.select?.name || null : undefined,
      credentialHash: this.textProperty(properties, verificationProperties.credentialHash),
      tierProof: this.textProperty(properties, verificationProperties.tierProof),
      verifiedAt: properties[verificationProperties.verifiedAt]?.date?.start ? Date.parse(properties[verificationProperties.verifiedAt]!.date!.start!) : null,
      pageId: page.id, exchangeId: (properties["Exchange UID"]?.rich_text || []).map((text) => text.plain_text || text.text?.content || "").join(""), email: properties[this.config.notionEmailProperty]?.email || "", status,
      dueAt: properties["Review Due At"]?.date?.start || null,
      paidAt: properties["Paid At"]?.date?.start || null,
      paymentDeadlineAt: properties["Payment Deadline At"]?.date?.start || null,
      archived: Boolean(page.archived || page.in_trash),
    };
  }
  private textProperty(properties: Record<string, Property>, name: string): string | null {
    const property = properties[name];
    if (property?.type !== "rich_text" || !Array.isArray(property.rich_text)) throw new UpstreamError("notion-verification-schema");
    return property.rich_text.map(t => t.plain_text ?? t.text?.content ?? "").join("").trim() || null;
  }
  private async queryMembers(filter: unknown): Promise<Member[]> {
    const members: Member[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    const params = new URLSearchParams();
    for (const field of [this.config.notionEmailProperty, this.config.notionDiscordIdProperty, ...Object.values(verificationProperties), discordRoleProperty, "Exchange UID", "Status", "Review Due At", "Paid At", "Payment Deadline At"]) params.append("filter_properties", field);
    for (let page = 0; page < 20; page++) {
      const response = await this.request(`/data_sources/${this.config.notionDataSourceId}/query?${params}`, {
        page_size: 100, ...(cursor ? { start_cursor: cursor } : {}), filter,
      }) as { results?: Page[]; has_more?: boolean; next_cursor?: string | null };
      if (!Array.isArray(response.results) || typeof response.has_more !== "boolean") throw new UpstreamError("notion-schema");
      members.push(...response.results.map(record => this.member(record)));
      if (!response.has_more) return members;
      if (!response.next_cursor || seenCursors.has(response.next_cursor)) throw new UpstreamError("notion-pagination");
      cursor = response.next_cursor; seenCursors.add(cursor);
    }
    throw new UpstreamError("notion-pagination-limit");
  }
  async findMember(exchangeId: string, email: string): Promise<Member | null> {
    const members = await this.queryMembers({ property: this.config.notionEmailProperty, email: { is_not_empty: true } });
    const matches = members.filter(m => !m.archived && normalizeEmail(m.email) === normalizeEmail(email) && normalizeExchangeId(m.exchangeId) === normalizeExchangeId(exchangeId));
    return matches.length === 1 ? matches[0]! : null;
  }
  async listBoundMembers(): Promise<Member[]> {
    return (await this.queryMembers({ property: this.config.notionDiscordIdProperty, rich_text: { is_not_empty: true } })).filter(m => !m.archived);
  }
  async findBinding(discordId: string): Promise<Member | null> {
    const matches = (await this.listBoundMembers()).filter(m => m.discordId === discordId);
    if (matches.length > 1) throw new NotionBindingConflict();
    return matches[0] || null;
  }
  async getMember(pageId: string): Promise<Member> {
    if (!/^[a-f0-9]{32}$/i.test(pageKey(pageId))) throw new UpstreamError("notion-page-id");
    const member = this.member(await this.request(`/pages/${pageId}`) as Page);
    if (pageKey(member.pageId) !== pageKey(pageId)) throw new UpstreamError("notion-page-id");
    return member;
  }
  async writeBinding(expected: Member, binding: BindingWrite): Promise<Member> {
    if (!isDiscordId(binding.discordId) || !/^[a-f0-9]{64}$/.test(binding.credentialHash) || !Number.isFinite(binding.verifiedAt)) throw new NotionBindingConflict();
    // Live Notion Date writes discard seconds and milliseconds. Normalize only this
    // audit timestamp, including pending writes created before this fix; membership
    // deadlines and all identity/proof comparisons retain their exact values.
    binding = { ...binding, verifiedAt: Math.floor(binding.verifiedAt / 60_000) * 60_000 };
    const check = (current: Member) => {
      if (current.archived || pageKey(current.pageId) !== pageKey(binding.pageId)
        || normalizeEmail(current.email) !== normalizeEmail(expected.email)
        || normalizeExchangeId(current.exchangeId) !== normalizeExchangeId(expected.exchangeId)
        || (current.discordId && current.discordId !== binding.discordId)) throw new NotionBindingConflict();
    };
    check(expected);
    const matches = (m: Member) => m.discordId === binding.discordId && m.credentialHash === binding.credentialHash && m.tierProof === binding.tierProof && m.verifiedAt === binding.verifiedAt;
    if (matches(expected)) return expected;
    const current = await this.getMember(expected.pageId);
    check(current);
    if (matches(current)) return current;
    const text = (value: string | null) => ({ rich_text: value ? [{ type: "text", text: { content: value } }] : [] });
    const updated = this.member(await this.request(`/pages/${current.pageId}`, {
      properties: {
        [this.config.notionDiscordIdProperty]: text(binding.discordId),
        [verificationProperties.credentialHash]: text(binding.credentialHash),
        [verificationProperties.tierProof]: text(binding.tierProof),
        [verificationProperties.verifiedAt]: { date: { start: new Date(binding.verifiedAt).toISOString() } },
      },
    }, "PATCH") as Page);
    check(updated);
    if (!matches(updated)) throw new UpstreamError("notion-write-unconfirmed");
    return updated;
  }
  async writeRole(expected: Member, role: string | null): Promise<void> {
    if (role !== null && !["探索者", "宇航員", "飛行員"].includes(role)) throw new UpstreamError("notion-role-value");
    const check = (current: Member) => {
      if (!isDiscordId(expected.discordId) || current.archived || current.discordId !== expected.discordId
        || pageKey(current.pageId) !== pageKey(expected.pageId)) throw new NotionBindingConflict();
      if (current.discordRole === undefined) throw new UpstreamError("notion-role-schema");
    };
    check(expected);
    if (expected.discordRole === role) return;
    // Recheck the binding before recording a Discord result on the member's page.
    const current = await this.getMember(expected.pageId);
    check(current);
    if (current.discordRole === role) return;
    const updated = this.member(await this.request(`/pages/${current.pageId}`, {
      properties: { [discordRoleProperty]: { select: role ? { name: role } : null } },
    }, "PATCH") as Page);
    check(updated);
    if (updated.discordRole !== role) throw new UpstreamError("notion-role-write-unconfirmed");
  }
}
