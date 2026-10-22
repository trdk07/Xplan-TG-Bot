import type { BindingWrite } from "./types";
export interface OperationStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}
// KV-backed operational state only. Guild-wide GateEngine serialization protects updates.
export class OperationStore {
  constructor(private storage: OperationStorage) {}
  async cleanup(now: number) {
    for (const [key, value] of await this.storage.list<{ until: number }>({ prefix: "ttl:" })) {
      if (value.until <= now) await this.storage.delete(key);
    }
  }
  async rateLimit(key: string, limit: number, window: number, now: number): Promise<boolean> {
    const name = `ttl:rate:${key}`;
    const old = await this.storage.get<{ hits: number; until: number }>(name);
    const entry = old && old.until > now ? { ...old, hits: old.hits + 1 } : { hits: 1, until: now + window };
    await this.storage.put(name, entry);
    return entry.hits <= limit;
  }
  async claimInteraction(id: string, now: number): Promise<boolean> {
    const name = `ttl:interaction:${id}`;
    const old = await this.storage.get<{ until: number }>(name);
    if (old && old.until > now) return false;
    await this.storage.put(name, { until: now + 20 * 60_000 });
    return true;
  }
  async reserve(binding: BindingWrite): Promise<boolean> {
    // Reconcile an uncertain PATCH before claiming another page or account.
    for (const pending of await this.pending()) {
      if ((pending.discordId === binding.discordId && pending.pageId !== binding.pageId)
        || (pending.pageId === binding.pageId && pending.discordId !== binding.discordId)) return false;
    }
    await this.storage.put(`pending:${binding.discordId}`, binding);
    return true;
  }
  async pending(): Promise<BindingWrite[]> { return [...(await this.storage.list<BindingWrite>({ prefix: "pending:" })).values()]; }
  async clearPending(discordId: string) { await this.storage.delete(`pending:${discordId}`); }
  // Only records which Discord accounts may need role cleanup, never grants access by itself.
  async trackRole(discordId: string) { await this.storage.put(`role:${discordId}`, true); }
  async forgetRole(discordId: string) { await this.storage.delete(`role:${discordId}`); }
  async roleTargets(): Promise<string[]> { return [...(await this.storage.list({ prefix: "role:" })).keys()].map(key => key.slice(5)); }
}
