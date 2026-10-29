import { sumAmounts } from "@/lib/membership-v2";
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  run(): Promise<{ meta?: { changes?: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface EvidenceDatabase {
  prepare(sql: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<unknown[]>;
}
export type DepositEvent = {
  id: string;
  asset: string;
  amount: string;
  usdtAmount: string | null;
  at: string;
  kind: "deposit" | "own_transfer";
};
export type MembershipTransition = {
  key: string;
  pageId: string;
  fromTier: string;
  toTier: string;
  windowEnd: string | null;
  kind: "volume_upgrade" | "volume_downgrade" | "paid_expiry";
};
/** Contains financial evidence/delivery receipts only; membership remains in Notion. */
export class EvidenceStore {
  constructor(private db: EvidenceDatabase) {}
  async recordTransition(event: MembershipTransition) {
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO membership_transitions(event_key,page_id,from_tier,to_tier,window_end,kind,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        event.key,
        event.pageId.replaceAll("-", "").toLowerCase(),
        event.fromTier,
        event.toTier,
        event.windowEnd,
        event.kind,
        new Date().toISOString(),
      )
      .run();
  }
  async pendingTransitions(pageId: string): Promise<MembershipTransition[]> {
    const rows = await this.db
      .prepare(
        "SELECT event_key AS key,page_id AS pageId,from_tier AS fromTier,to_tier AS toTier,window_end AS windowEnd,kind FROM membership_transitions WHERE page_id=? AND handled_at IS NULL ORDER BY created_at,event_key LIMIT 100",
      )
      .bind(pageId.replaceAll("-", "").toLowerCase())
      .all<MembershipTransition>();
    return rows.results;
  }
  async completeTransition(key: string) {
    await this.db
      .prepare(
        "UPDATE membership_transitions SET handled_at=? WHERE event_key=?",
      )
      .bind(new Date().toISOString(), key)
      .run();
  }
  async reserveAccount(pageId: string, exchange: string, uid: string) {
    pageId = pageId.replaceAll("-", "").toLowerCase();
    await this.db.batch([
      this.db
        .prepare(
          "DELETE FROM account_bindings WHERE page_id=? AND NOT(exchange=? AND uid=?)",
        )
        .bind(pageId, exchange, uid),
      this.db
        .prepare(
          "INSERT INTO account_bindings(exchange,uid,page_id) VALUES(?,?,?) ON CONFLICT(exchange,uid) DO UPDATE SET page_id=CASE WHEN account_bindings.page_id=excluded.page_id THEN excluded.page_id ELSE NULL END",
        )
        .bind(exchange, uid, pageId),
    ]);
    const owner = await this.db
      .prepare(
        "SELECT page_id FROM account_bindings WHERE exchange=? AND uid=?",
      )
      .bind(exchange, uid)
      .first<{ page_id: string }>();
    if (owner?.page_id !== pageId)
      throw new Error("Account is already reserved by another member");
  }
  async withQualificationLock<T>(
    pageId: string,
    work: (guard: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    pageId = pageId.replaceAll("-", "").toLowerCase();
    const token = crypto.randomUUID(),
      now = Date.now(),
      expires = now + 600000;
    const claim = await this.db
      .prepare(
        "INSERT INTO qualification_locks(page_id,token,expires_at) VALUES(?,?,?) ON CONFLICT(page_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE qualification_locks.expires_at<=?",
      )
      .bind(pageId, token, expires, now)
      .run();
    if (claim.meta?.changes !== 1) throw new Error("qualification_in_progress");
    const guard = async () => {
      const row = await this.db
        .prepare(
          "SELECT token,expires_at FROM qualification_locks WHERE page_id=?",
        )
        .bind(pageId)
        .first<{ token: string; expires_at: number }>();
      if (row?.token !== token || row.expires_at <= Date.now())
        throw new Error("qualification_lease_expired");
    };
    try {
      return await work(guard);
    } finally {
      await this.db
        .prepare("DELETE FROM qualification_locks WHERE page_id=? AND token=?")
        .bind(pageId, token)
        .run();
    }
  }
  async recordDeposits(exchange: string, uid: string, events: DepositEvent[]) {
    const queries = events.map((event) => {
      if (!event.id || !event.asset || !event.at)
        throw new Error("Invalid deposit evidence");
      sumAmounts([event.amount]);
      if (event.usdtAmount !== null) sumAmounts([event.usdtAmount]);
      return this.db
        .prepare(
          "INSERT OR IGNORE INTO deposit_events(exchange,uid,event_id,asset,amount,usdt_amount,occurred_at,kind) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          exchange,
          uid,
          event.id,
          event.asset,
          event.amount,
          event.usdtAmount,
          event.at,
          event.kind,
        );
    });
    for (let i = 0; i < queries.length; i += 50)
      await this.db.batch(queries.slice(i, i + 50));
  }
  async depositTotal(exchange: string, uid: string) {
    const rows = await this.db
      .prepare(
        "SELECT usdt_amount FROM deposit_events WHERE exchange=? AND uid=? AND kind='deposit' AND usdt_amount IS NOT NULL",
      )
      .bind(exchange, uid)
      .all<{ usdt_amount: string }>();
    return sumAmounts(rows.results.map((row) => row.usdt_amount));
  }
  async deliverOnce(
    key: string,
    send: () => Promise<unknown>,
  ): Promise<"sent" | "already_sent" | "held"> {
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO notification_outbox(key,state,created_at) VALUES(?,'pending',?)",
      )
      .bind(key, new Date().toISOString())
      .run();
    const claim = await this.db
      .prepare(
        "UPDATE notification_outbox SET state='sending' WHERE key=? AND state='pending'",
      )
      .bind(key)
      .run();
    if (claim.meta?.changes !== 1) {
      const row = await this.db
        .prepare("SELECT state FROM notification_outbox WHERE key=?")
        .bind(key)
        .first<{ state: string }>();
      return row?.state === "sent" ? "already_sent" : "held";
    }
    try {
      await send();
      await this.db
        .prepare(
          "UPDATE notification_outbox SET state='sent',sent_at=? WHERE key=?",
        )
        .bind(new Date().toISOString(), key)
        .run();
      return "sent";
    } catch (error) {
      await this.db
        .prepare("UPDATE notification_outbox SET state='unknown' WHERE key=?")
        .bind(key)
        .run()
        .catch(() => {});
      throw error;
    }
  }
  async heldNotifications() {
    return (
      await this.db
        .prepare(
          "SELECT key,state,created_at FROM notification_outbox WHERE state IN ('sending','unknown') ORDER BY created_at DESC LIMIT 100",
        )
        .all<{ key: string; state: string; created_at: string }>()
    ).results;
  }
}
export async function getEvidenceStore(): Promise<EvidenceStore> {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as unknown as { MEMBERSHIP_EVIDENCE_DB?: EvidenceDatabase })
    .MEMBERSHIP_EVIDENCE_DB;
  if (!db) throw new Error("MEMBERSHIP_EVIDENCE_DB is required for v2");
  return new EvidenceStore(db);
}
