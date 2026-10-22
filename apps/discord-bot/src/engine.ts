import { isDiscordId, pageKey } from "./config";
import { digest, sameDigest } from "./crypto";
import { decisionMessage, evaluateMember, normalizeEmail, normalizeExchangeId, roleLabel, validEmail } from "./membership";
import { field, ids, withSync } from "./messages";
import { NotionBindingConflict, UpstreamError } from "./notion";
import { previousBinding, tierProof } from "./proof";
import { OperationStore } from "./store";
import type { BindingWrite, Config, Decision, Interaction, Member, MessageBody, Services } from "./types";

export class GateEngine {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private operations: OperationStore, private services: Services, private config: Config, private now = () => Date.now()) {}
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(fn);
    this.queue = next;
    return next;
  }
  async process(interaction: Interaction): Promise<void> {
    const message = await this.locked(async () => {
      const discordId = interaction.member!.user!.id;
      await this.operations.cleanup(this.now());
      if (!await this.operations.claimInteraction(interaction.id, this.now())) return null;
      try {
        if (interaction.data?.custom_id === ids.credentials) return await this.verifyMember(discordId, field(interaction.data.components, "exchange_id"), field(interaction.data.components, "email"));
        if (interaction.data?.custom_id === ids.sync) {
          if (!await this.operations.rateLimit(`sync:${discordId}`, 1, 10_000, this.now())) return withSync("請稍候 10 秒再更新身分組。");
          return withSync(await this.synchronize(discordId));
        }
        return withSync("請重新點擊會員驗證入口。");
      } catch (error) {
        console.error("member_verification_failed", safeError(error));
        if (error instanceof UpstreamError && error.service === "notion-role-sync") return withSync("Discord 身分組已完成處理，但 Notion 身分組紀錄暫時無法更新。系統會自動重試，也可稍後點「更新身分組」。");
        return withSync("驗證服務暫時無法完成處理，請稍後重試。已送出綁定者可點「更新身分組」。");
      }
    });
    if (!message) return;
    try { await this.services.reply(interaction, message); }
    catch (error) { console.error("interaction_reply_failed", safeError(error)); }
  }
  private credentialHash(discordId: string, exchangeId: string, email: string) {
    // Bind the credential proof to the Discord account, so editing Discord_id is not verification.
    return digest(this.config.authSecret, JSON.stringify(["discord-member-v1", discordId, normalizeExchangeId(exchangeId), normalizeEmail(email)]));
  }
  private async decision(member: Member) {
    return evaluateMember(member, this.now(), await previousBinding(this.config.authSecret, member), this.config.tierOverrides, this.config.incompleteMemberPolicy);
  }
  verify(discordId: string, rawId: string, rawEmail: string): Promise<MessageBody> {
    return this.locked(() => this.verifyMember(discordId, rawId, rawEmail));
  }
  private async verifyMember(discordId: string, rawId: string, rawEmail: string): Promise<MessageBody> {
    const exchangeId = normalizeExchangeId(rawId), email = normalizeEmail(rawEmail);
    if (!isDiscordId(discordId) || !exchangeId || exchangeId.length > 100 || !validEmail(email)) return withSync("請填寫完整的 Exchange ID 和報名 Email。");
    const now = this.now();
    const accountAllowed = await this.operations.rateLimit(`verify:${discordId}`, 5, 15 * 60_000, now);
    const guildAllowed = await this.operations.rateLimit("guild:verify", 300, 15 * 60_000, now);
    if (!accountAllowed || !guildAllowed) return withSync("驗證嘗試次數較多，請稍後再試。每個帳號每 15 分鐘最多嘗試 5 次。");
    const found = await this.services.findMember(exchangeId, email);
    const invalid = () => withSync("Exchange ID 與 Email 無法配對到唯一的會員資料，請確認報名資料或聯絡助理。");
    if (!found) return invalid();
    let member = await this.services.getMember(found.pageId);
    const hash = await this.credentialHash(discordId, exchangeId, email);
    if (!sameDigest(hash, await this.credentialHash(discordId, member.exchangeId, member.email))) return invalid();
    let existing: Member | null;
    try { existing = await this.services.findBinding(discordId); }
    catch (error) { if (error instanceof NotionBindingConflict) return withSync(await this.block(discordId)); throw error; }
    if (existing && pageKey(existing.pageId) !== pageKey(member.pageId)) return withSync("此 Discord 帳號已綁定其他會員資料，請聯絡助理確認。");
    if (member.discordId && member.discordId !== discordId) return withSync("這份會籍已綁定其他 Discord 帳號，請聯絡助理確認。");
    const decision = await this.decision(member);
    if (decision.state === "deny" && !existing) return withSync(decisionMessage(decision));
    const binding: BindingWrite = { discordId, pageId: member.pageId, credentialHash: hash, verifiedAt: now,
      tierProof: decision.state === "allow" ? await tierProof(this.config.authSecret, member, discordId, hash, decision.tier) : member.tierProof };
    if (!await this.operations.reserve(binding)) return withSync("此帳號或會籍有待確認的綁定，請先更新原綁定或聯絡助理。");
    if (decision.state !== "allow") await this.applyDecision(discordId, decision, member);
    try { member = await this.commit(member, binding); }
    catch (error) { if (error instanceof NotionBindingConflict) return withSync(await this.block(discordId)); throw error; }
    return withSync(await this.applyMember(discordId, member));
  }
  private async commit(member: Member, binding: BindingWrite): Promise<Member> {
    const existing = await this.services.findBinding(binding.discordId);
    if (existing && pageKey(existing.pageId) !== pageKey(binding.pageId)) throw new NotionBindingConflict();
    const updated = await this.services.writeBinding(member, binding);
    await this.operations.clearPending(binding.discordId);
    return updated;
  }
  private async block(discordId: string, member?: Member): Promise<string> {
    await this.applyDecision(discordId, { state: "deny", reason: "blocked" }, member);
    return "會員資料或 Discord 綁定已變更，請重新驗證或聯絡助理確認。免費資源仍可使用。";
  }
  private async applyMember(discordId: string, member: Member): Promise<string> {
    if (member.discordId !== discordId || !member.credentialHash
      || !sameDigest(member.credentialHash, await this.credentialHash(discordId, member.exchangeId, member.email))) return this.block(discordId, member);
    const decision = await this.decision(member);
    // Expiry does not depend on a metadata PATCH succeeding.
    if (decision.state !== "allow") return this.applyDecision(discordId, decision, member);
    const proof = await tierProof(this.config.authSecret, member, discordId, member.credentialHash, decision.tier);
    if (proof !== member.tierProof) {
      const binding: BindingWrite = { discordId, pageId: member.pageId, credentialHash: member.credentialHash, verifiedAt: member.verifiedAt || this.now(), tierProof: proof };
      if (!await this.operations.reserve(binding)) return this.block(discordId, member);
      member = await this.commit(member, binding);
    }
    return this.applyDecision(discordId, await this.decision(member), member);
  }
  private async applyDecision(discordId: string, decision: Decision, member?: Member): Promise<string> {
    if (decision.state === "allow") await this.operations.trackRole(discordId);
    const result = await this.services.applyRoles(discordId, decision);
    if (member && member.discordId === discordId && !member.archived && result !== "screening_pending"
      && (decision.state !== "review" || result === "not_in_guild")) {
      const role = result === "updated" && decision.state === "allow" ? roleLabel(decision.tier) : null;
      try { await this.services.writeRole(member, role); }
      catch (error) {
        // Discord already succeeded. Preserve cleanup tracking and retry from fresh state.
        console.error("notion_role_write_failed", safeError(error));
        throw new UpstreamError("notion-role-sync");
      }
    }
    if (decision.state === "deny" && result !== "screening_pending") await this.operations.forgetRole(discordId);
    if (result === "not_in_guild") return "帳號已綁定。請先加入指定 Discord 伺服器，再點「更新身分組」。";
    if (result === "screening_pending") return "帳號已綁定。請先完成 Discord 伺服器的規則確認，再點「更新身分組」。";
    return decisionMessage(decision);
  }
  private async synchronize(discordId: string): Promise<string> {
    try {
      const pending = (await this.operations.pending()).find(p => p.discordId === discordId);
      if (pending) {
        const member = await this.services.getMember(pending.pageId);
        if (!sameDigest(pending.credentialHash, await this.credentialHash(discordId, member.exchangeId, member.email))) return this.block(discordId, member);
        const decision = await this.decision(member);
        if (decision.state !== "allow") await this.applyDecision(discordId, decision, member);
        await this.commit(member, pending);
      }
      const found = await this.services.findBinding(discordId);
      if (!found) {
        if ((await this.operations.roleTargets()).includes(discordId)) await this.applyDecision(discordId, { state: "deny", reason: "blocked" });
        return "你還沒有綁定現有會員資料，請先點「重新驗證」。";
      }
      return this.applyMember(discordId, await this.services.getMember(found.pageId));
    } catch (error) { if (error instanceof NotionBindingConflict) return this.block(discordId); throw error; }
  }
  syncBatch(after: string): Promise<{ next: string | null; checked: number; errors: number }> {
    return this.locked(async () => {
      await this.operations.cleanup(this.now());
      const members = await this.services.listBoundMembers(); // Fail closed on incomplete/failed enumeration.
      const ids = [...new Set([...members.map(m => m.discordId), ...(await this.operations.pending()).map(p => p.discordId), ...await this.operations.roleTargets()])]
        .filter((id): id is string => isDiscordId(id) && id > after).sort().slice(0, 5);
      let errors = 0;
      for (const id of ids) {
        try { await this.synchronize(id); }
        catch (error) { errors++; console.error("membership_sync_failed", safeError(error)); }
      }
      return { next: ids.length === 5 ? ids.at(-1)! : null, checked: ids.length, errors };
    });
  }

}
export function safeError(error: unknown): string { return error instanceof UpstreamError ? `${error.service}:${error.status}` : "internal"; }
