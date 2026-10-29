import { isDiscordId } from "./config";
import { timedFetch, UpstreamError } from "./notion";
import type { Config, Decision, Fetcher, GuildMember, GuildPage, Interaction, MessageBody, RoleResult } from "./types";
// Keep each DO batch below the external-request budget, including Notion reads.
const guildPageSize = 10;
export class DiscordClient {
  constructor(private config: Config, private fetcher: Fetcher = fetch) {}
  private request(path: string, method: string, body?: unknown): Promise<Response> {
    return timedFetch(this.fetcher, `https://discord.com/api/v10${path}`, {
      method,
      headers: { Authorization: `Bot ${this.config.botToken}`, "Content-Type": "application/json", "X-Audit-Log-Reason": "Xplan verified Notion membership sync" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async applyRoles(discordId: string, decision: Decision): Promise<"updated" | "not_in_guild" | "screening_pending"> {
    const prefix = `/guilds/${this.config.guildId}/members/${discordId}`;
    const response = await this.request(prefix, "GET");
    if (response.status === 404) {
      const error = await response.json().catch(() => ({})) as { code?: number };
      if (error.code === 10007) return "not_in_guild";
    }
    if (!response.ok) throw new UpstreamError("discord", response.status);
    const member = await response.json() as { roles?: string[]; pending?: boolean; user?: { bot?: boolean } };
    if (!Array.isArray(member.roles)) throw new UpstreamError("discord-schema");
    if (this.config.membershipPolicyV2Enabled && member.user?.bot) return "screening_pending";
    // Granting roles must not bypass Discord's server rule screening.
    if (member.pending && decision.state === "allow") return "screening_pending";
    if (decision.state === "review") return "updated"; // Data ambiguity does not justify destructive changes.
    const desired = decision.state === "deny" ? null : {
      trial: this.config.trialRoleId, explorer: this.config.trialRoleId, paid: this.config.memberRoleId, volume: this.config.memberRoleId,
      non_expiring: this.config.membershipPolicyV2Enabled ? this.config.memberRoleId : this.config.nonExpiringRoleId, partner: this.config.partnerRoleId,
    }[decision.tier];
    const managed = new Set([this.config.trialRoleId, this.config.memberRoleId, this.config.nonExpiringRoleId, this.config.partnerRoleId]);
    // Remove stale paid access before adding a lower tier; touch only our configured roles.
    for (const role of member.roles.filter((role) => managed.has(role) && role !== desired)) {
      const result = await this.request(`${prefix}/roles/${role}`, "DELETE");
      if (!result.ok) throw new UpstreamError("discord", result.status);
    }
    if (desired && !member.roles.includes(desired)) {
      const result = await this.request(`${prefix}/roles/${desired}`, "PUT");
      if (!result.ok) throw new UpstreamError("discord", result.status);
    }
    return "updated";
  }
  async listGuildMembers(after: string): Promise<GuildPage> {
    if (after && !isDiscordId(after)) throw new UpstreamError("discord-pagination");
    const query = new URLSearchParams({ limit: String(guildPageSize), ...(after ? { after } : {}) });
    const response = await this.request(`/guilds/${this.config.guildId}/members?${query}`, "GET");
    if (!response.ok) throw new UpstreamError("discord-members", response.status);
    const data: unknown = await response.json();
    if (!Array.isArray(data) || data.length > guildPageSize) throw new UpstreamError("discord-members-schema");
    const members: GuildMember[] = [];
    let cursor = after ? BigInt(after) : 0n;
    for (const value of data) {
      if (!value || !isDiscordId(value.user?.id) || !Array.isArray(value.roles) || !value.roles.every((role: unknown) => typeof role === "string")
        || BigInt(value.user.id) <= cursor) throw new UpstreamError("discord-pagination");
      cursor = BigInt(value.user.id);
      members.push({ discordId: value.user.id, roles: value.roles, bot: value.user.bot === true, pending: value.pending === true });
    }
    return { members, next: members.length === guildPageSize ? members.at(-1)!.discordId : null };
  }
  async applyDefaultExplorer(discordId: string): Promise<RoleResult | "skipped"> {
    // A fresh read protects against screening/role changes since enumeration. Never
    // call the normal downgrade path for an unbound member with premium roles.
    const prefix = `/guilds/${this.config.guildId}/members/${discordId}`;
    const response = await this.request(prefix, "GET");
    if (response.status === 404 && (await response.clone().json().catch(() => ({})) as { code?: number }).code === 10007) return "not_in_guild";
    if (!response.ok) throw new UpstreamError("discord", response.status);
    const member = await response.json() as { roles?: string[]; pending?: boolean; user?: { bot?: boolean } };
    if (!Array.isArray(member.roles)) throw new UpstreamError("discord-schema");
    if (member.pending) return "screening_pending";
    if (member.user?.bot || member.roles.some(role => [this.config.trialRoleId, this.config.memberRoleId, this.config.nonExpiringRoleId, this.config.partnerRoleId].includes(role))) return "skipped";
    const updated = await this.request(`${prefix}/roles/${this.config.trialRoleId}`, "PUT");
    if (!updated.ok) throw new UpstreamError("discord", updated.status);
    return "updated";
  }
  async reply(interaction: Interaction, message: MessageBody): Promise<void> {
    const response = await this.request(`/webhooks/${this.config.applicationId}/${encodeURIComponent(interaction.token)}/messages/@original`, "PATCH", {
      ...message, allowed_mentions: { parse: [] },
    });
    if (!response.ok) throw new UpstreamError("discord-reply", response.status);
  }
}
