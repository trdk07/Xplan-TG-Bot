import { DurableObject } from "cloudflare:workers";
import { getConfig } from "./config";
import { DiscordClient } from "./discord";
import { GateEngine } from "./engine";
import { httpHandler } from "./http";
import { NotionClient } from "./notion";
import { OperationStore } from "./store";
import type { Interaction } from "./types";

export type Env = Record<string, unknown> & {
  MEMBER_GATE: DurableObjectNamespace<NotionMemberGate>;
};
export class NotionMemberGate extends DurableObject<Env> {
  private engine: GateEngine;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const config = getConfig(env);
    const notion = new NotionClient(config), discord = new DiscordClient(config);
    this.engine = new GateEngine(new OperationStore(ctx.storage), {
      findMember: (id, email) => notion.findMember(id, email), getMember: id => notion.getMember(id),
      findBinding: id => notion.findBinding(id), listBoundMembers: () => notion.listBoundMembers(),
      writeBinding: (member, binding) => notion.writeBinding(member, binding),
      writeRole: (member, role) => notion.writeRole(member, role),
      applyRoles: (id, decision) => discord.applyRoles(id, decision), reply: (interaction, message) => discord.reply(interaction, message),
    }, config);
  }
  processInteraction(interaction: Interaction) { return this.engine.process(interaction); }
  syncBatch(after: string) { return this.engine.syncBatch(after); }
}
export const handler = {
  fetch: httpHandler.fetch,
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const guildId = getConfig(env).guildId;
    const stub = env.MEMBER_GATE.get(env.MEMBER_GATE.idFromName(`guild:${guildId}`));
    let cursor = "", checked = 0, errors = 0;
    do {
      const result = await stub.syncBatch(cursor); checked += result.checked; errors += result.errors;
      if (!result.next) break; cursor = result.next;
    } while (true);
    console.log("membership_sync_complete", { checked, errors, source: "notion" });
  },
} satisfies ExportedHandler<Env>;
export default handler;
