import { type Exchange, sumAmounts } from "@/lib/membership-v2";
import type { DepositEvent } from "@/lib/evidence-store";
export type AdmissionEvidence = {
  referral: boolean | null;
  cumulative: string;
  complete: boolean;
  events: DepositEvent[];
};
export type VolumeEvidence = { spot: string; futures: string };
export class ExchangeCheckError extends Error {}
type Row = Record<string, any>;
// Only deposit history may retain already-scoped pages after a later read fails.
class PartialDepositHistory extends ExchangeCheckError {
  constructor(readonly rows: Row[]) {
    super("deposit_history_incomplete");
  }
}
async function sign(secret: string, value: string, hex = false) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return hex
    ? [...signature].map((x) => x.toString(16).padStart(2, "0")).join("")
    : btoa(String.fromCharCode(...signature));
}
/** Official affiliate interfaces only. Capability gates prohibit unproven scopes/units. */
export class ExchangeClient {
  constructor(
    private env: Record<string, string | undefined> = process.env,
    private fetcher: typeof fetch = fetch,
    private now = new Date(),
  ) {}
  private require(exchange: Exchange, capability: "ADMISSION" | "VOLUME") {
    const prefix = exchange.toUpperCase();
    if (this.env[`${prefix}_${capability}_ENABLED`] !== "true")
      throw new ExchangeCheckError(`${capability.toLowerCase()}_disabled`);
    if (
      capability === "VOLUME" &&
      ["UNIT", "COVERAGE", "WINDOW"].some(
        (kind) => this.env[`${prefix}_VOLUME_${kind}_VERIFIED`] !== "true",
      )
    )
      throw new ExchangeCheckError("volume_not_verified");
  }
  private remaining(deadline: number): number {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new ExchangeCheckError("operation_budget_exceeded");
    return remaining;
  }
  private async request(
    exchange: Exchange,
    path: string,
    values: Record<string, string>,
    deadline: number,
  ): Promise<Row> {
    const prefix = exchange.toUpperCase();
    const key =
      this.env[`${prefix}_API_KEY`] ||
      (exchange === "mexc" ? this.env.MEXC_API_ACCESS_KEY : undefined);
    const secret = this.env[`${prefix}_API_SECRET_KEY`];
    const passphrase = this.env[`${prefix}_API_PASSPHRASE`];
    if (!key || !secret || (exchange !== "mexc" && !passphrase))
      throw new ExchangeCheckError("credentials_missing");
    const method = exchange === "bitget" ? "POST" : "GET";
    const body = method === "POST" ? JSON.stringify(values) : "";
    const host = {
      mexc: "https://api.mexc.com",
      bitget: "https://api.bitget.com",
      okx: "https://www.okx.com",
    }[exchange];
    for (let attempt = 0; attempt < 3; attempt++) {
      this.remaining(deadline);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      let query =
        exchange === "bitget"
          ? ""
          : new URLSearchParams({
              ...values,
              ...(exchange === "mexc" ? { timestamp: String(Date.now()) } : {}),
            }).toString();
      const timestamp =
        exchange === "okx" ? new Date().toISOString() : String(Date.now());
      if (exchange === "mexc") {
        query += "&signature=" + (await sign(secret, query, true));
        headers["X-MEXC-APIKEY"] = key;
        if (this.env.MEXC_AFFILIATE_MEMBER_INFO)
          headers.memberInfo = this.env.MEXC_AFFILIATE_MEMBER_INFO;
      } else {
        const tag = exchange === "okx" ? "OK-ACCESS-" : "ACCESS-";
        headers[tag + "KEY"] = key;
        headers[tag + "PASSPHRASE"] = passphrase!;
        headers[tag + "TIMESTAMP"] = timestamp;
        headers[tag + "SIGN"] = await sign(
          secret,
          timestamp + method + path + (query ? "?" + query : "") + body,
        );
      }
      const response = await this.fetcher(
        host + path + (query ? "?" + query : ""),
        {
          method,
          headers,
          body: body || undefined,
          signal: AbortSignal.timeout(
            Math.min(10000, this.remaining(deadline)),
          ),
          redirect: "error",
        },
      );
      this.remaining(deadline);
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const retrySeconds = Number(response.headers.get("Retry-After") ?? "1");
        const delay =
          Number.isFinite(retrySeconds) && retrySeconds >= 0
            ? retrySeconds * 1000
            : 1000;
        if (!Number.isFinite(delay) || delay >= this.remaining(deadline))
          throw new ExchangeCheckError("operation_budget_exceeded");
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      if (!response.ok)
        throw new ExchangeCheckError(`upstream_http_${response.status}`);
      const result = (await response.json()) as Row;
      this.remaining(deadline);
      if (
        result.success === false ||
        !["0", "00000", "200"].includes(String(result.code ?? "0"))
      )
        throw new ExchangeCheckError("upstream_rejected");
      return result;
    }
    throw new ExchangeCheckError("upstream_unavailable");
  }
  private scoped(rows: unknown, uid: string): Row[] {
    if (
      !Array.isArray(rows) ||
      rows.some((row) => !row || String(row.uid) !== uid)
    )
      throw new ExchangeCheckError("unexpected_account");
    return rows;
  }
  private async bitgetPages(
    endpoint: string,
    uid: string,
    deadline: number,
    extra: Record<string, string> = {},
  ) {
    const rows: Row[] = [];
    const seen = new Set<string>();
    try {
      for (let page = 1; page <= 100; page++) {
        const result = await this.request(
          "bitget",
          "/api/v2/broker/" + endpoint,
          { uid, ...extra, pageNo: String(page), pageSize: "1000" },
          deadline,
        );
        const batch = this.scoped(result.data, uid);
        const fingerprint = JSON.stringify(batch);
        if (batch.length && seen.has(fingerprint))
          throw new ExchangeCheckError("pagination_repeated");
        seen.add(fingerprint);
        rows.push(...batch);
        if (batch.length < 1000) return rows;
      }
      throw new ExchangeCheckError("pagination_incomplete");
    } catch (error) {
      if (endpoint === "customer-deposit")
        throw new PartialDepositHistory(rows);
      throw error;
    }
  }
  async admission(exchange: Exchange, uid: string): Promise<AdmissionEvidence> {
    const deadline = Date.now() + 120000;
    this.require(exchange, "ADMISSION");
    if (!/^\d{1,32}$/.test(uid)) throw new ExchangeCheckError("invalid_uid");
    if (exchange === "mexc") {
      const data = await this.request(
        exchange,
        "/api/v3/rebate/affiliate/referral",
        { uid, page: "1", pageSize: "100" },
        deadline,
      );
      const rows = this.scoped(data.data?.resultList, uid);
      if (Number(data.data?.totalCount || rows.length) > rows.length)
        throw new ExchangeCheckError("pagination_incomplete");
      if (rows.length > 1) throw new ExchangeCheckError("ambiguous_account");
      return {
        referral: rows.length === 1,
        cumulative: sumAmounts([String(rows[0]?.depositAmount || "0")]),
        complete: false,
        events: [],
      };
    }
    if (exchange === "okx") {
      // Detail does not always echo the UID: prove its unique affiliate scope first.
      const listed = await this.request(
        exchange,
        "/api/v5/affiliate/invitee/list",
        { uid, page: "1", limit: "100" },
        deadline,
      );
      const matches = this.scoped(listed.data, uid),
        pages = Number(listed.totalPage ?? 1);
      if (!Number.isInteger(pages) || pages < 1 || pages > 1)
        throw new ExchangeCheckError("pagination_incomplete");
      if (matches.length !== 1)
        throw new ExchangeCheckError("ambiguous_account");
      const data = await this.request(
        exchange,
        "/api/v5/affiliate/invitee/detail",
        { uid },
        deadline,
      );
      if (!Array.isArray(data.data) || data.data.length !== 1 || !data.data[0])
        throw new ExchangeCheckError("ambiguous_account");
      const row = data.data[0];
      if (row.uid !== undefined) this.scoped(data.data, uid);
      return {
        referral: row.inviteeLevel === "2",
        cumulative: sumAmounts([String(row.depAmt)]),
        complete: true,
        events: [],
      };
    }
    const clients = await this.bitgetPages("customer-list", uid, deadline);
    if (clients.length !== 1)
      return {
        referral: clients.length === 0 ? false : null,
        cumulative: "0",
        complete: false,
        events: [],
      };
    const end = this.now.getTime(),
      earliest = end - 90 * 86400000 + 1;
    const register = Number(clients[0].registerTime);
    const validRegistration = Number.isFinite(register) && register <= end;
    const start =
      validRegistration && register > earliest ? register : earliest;
    const events: DepositEvent[] = [];
    let historyComplete = true;
    history: for (let at = start; at <= end; at += 30 * 86400000) {
      let rows: Row[];
      try {
        rows = await this.bitgetPages("customer-deposit", uid, deadline, {
          showSub: "no",
          startTime: String(at),
          endTime: String(Math.min(end, at + 30 * 86400000 - 1)),
        });
      } catch (error) {
        if (!(error instanceof PartialDepositHistory)) throw error;
        rows = error.rows;
        historyComplete = false;
      }
      for (const row of rows) {
        try {
          if (
            !row.orderId ||
            !row.depositCoin ||
            row.depositAmount === undefined ||
            !row.depositTime
          )
            throw new ExchangeCheckError("deposit_schema");
          const amount = sumAmounts([String(row.depositAmount)]),
            timestamp = Number(row.depositTime);
          if (!Number.isFinite(timestamp) || timestamp > end)
            throw new ExchangeCheckError("deposit_schema");
          const at = new Date(timestamp).toISOString();
          events.push({
            id: String(row.orderId),
            asset: String(row.depositCoin),
            amount,
            usdtAmount: row.depositCoin === "USDT" ? amount : null,
            at,
            kind: "deposit",
          });
        } catch {
          // Keep only validated historical lower-bound evidence; never turn a malformed
          // or failed later row into a complete-history claim or a volume success.
          historyComplete = false;
          break history;
        }
      }
      if (!historyComplete) break;
    }
    return {
      referral: true,
      cumulative: "0",
      complete:
        historyComplete &&
        validRegistration &&
        register >= earliest &&
        events.every((e) => e.usdtAmount !== null),
      events,
    };
  }
  async volume(
    exchange: Exchange,
    uid: string,
    window: { start: string; end: string },
  ): Promise<VolumeEvidence> {
    const deadline = Date.now() + 120000;
    this.require(exchange, "VOLUME");
    if (!/^\d{1,32}$/.test(uid)) throw new ExchangeCheckError("invalid_uid");
    const start = Date.parse(window.start),
      end = Date.parse(window.end);
    if (!Number.isFinite(start) || end - start !== 30 * 86400000)
      throw new ExchangeCheckError("invalid_window");
    if (exchange === "bitget") {
      const rows = await this.bitgetPages(
        "customer-trade-volume",
        uid,
        deadline,
        {
          showSub: "no",
          startTime: String(start - 1),
          endTime: String(end - 1),
        },
      );
      const dates = new Set(rows.map((row) => Number(row.time)));
      if (
        rows.length !== 30 ||
        dates.size !== 30 ||
        [...dates].some(
          (t) => t < start || t >= end || (t - start) % 86400000 !== 0,
        )
      )
        throw new ExchangeCheckError("incomplete_volume_window");
      if (
        rows.some(
          (row) =>
            sumAmounts([String(row.spotVolume), String(row.futuresVolume)]) !==
            sumAmounts([String(row.volumn)]),
        )
      )
        throw new ExchangeCheckError("volume_total_mismatch");
      return {
        spot: sumAmounts(rows.map((row) => String(row.spotVolume))),
        futures: sumAmounts(rows.map((row) => String(row.futuresVolume))),
      };
    }
    if (exchange === "okx") {
      const totals: string[] = [];
      for (const category of ["SPOT", "DERIVATIVE"]) {
        const result = await this.request(
          exchange,
          "/api/v5/affiliate/invitee/list",
          {
            uid,
            page: "1",
            limit: "100",
            periodType: "custom",
            begin: String(start),
            end: String(end - 1),
            commissionCategory: category,
          },
          deadline,
        );
        const rows = this.scoped(result.data, uid);
        if (rows.length !== 1 || Number(result.totalPage || 1) > 1)
          throw new ExchangeCheckError("incomplete_volume_window");
        totals.push(sumAmounts([String(rows[0].totalVol)]));
      }
      return { spot: totals[0], futures: totals[1] };
    }
    // Commission-eligible turnover is never authoritative full trading turnover.
    // MEXC full spot/futures coverage is unavailable, irrespective of operator flags.
    throw new ExchangeCheckError("full_turnover_unavailable");
  }
}
