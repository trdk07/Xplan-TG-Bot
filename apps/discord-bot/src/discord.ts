import { timedFetch, UpstreamError } from "./notion";
import type { Config, Decision, Fetcher, Interaction, MessageBody } from "./types";
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
    const member = await response.json() as { roles?: string[]; pending?: boolean };
    if (!Array.isArray(member.roles)) throw new UpstreamError("discord-schema");
    // Granting roles must not bypass Discord's server rule screening.
    if (member.pending && decision.state === "allow") return "screening_pending";
    if (decision.state === "review") return "updated"; // Data ambiguity does not justify destructive changes.
    const desired = decision.state === "deny" ? null : {
      trial: this.config.trialRoleId, paid: this.config.memberRoleId,
      non_expiring: this.config.nonExpiringRoleId, partner: this.config.partnerRoleId,
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
  async reply(interaction: Interaction, message: MessageBody): Promise<void> {
    const response = await this.request(`/webhooks/${this.config.applicationId}/${encodeURIComponent(interaction.token)}/messages/@original`, "PATCH", {
      ...message, allowed_mentions: { parse: [] },
    });
    if (!response.ok) throw new UpstreamError("discord-reply", response.status);
  }
}
