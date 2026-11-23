import {
  type Exchange,
  MINIMUM_DEPOSIT_USDT,
  amountAtLeast,
  amountRemainder,
  completedVolumeWindow,
  hasVolumePrerequisites,
  sumAmounts,
} from "@/lib/membership-v2";
import type { DepositEvent } from "@/lib/evidence-store";
export type AdmissionEvidence = {
  referral: boolean | null;
  cumulative: string;
  complete: boolean;
  events: DepositEvent[];
};
export type VolumeEvidence =
  | {
      spot: string;
      futures: string;
      /** Turnover the exchange counts beyond spot and futures (on-chain, CFD, stocks). */
      other?: string;
      reportedTotal?: never;
    }
  | { spot: null; futures: null; other?: never; reportedTotal: string };
export function totalVolume(volume: VolumeEvidence): string {
  return volume.spot === null
    ? volume.reportedTotal
    : sumAmounts([volume.spot, volume.futures, volume.other ?? "0"]);
}
export type VolumeDay = { time: number; spot: string; futures: string; total: string };
export type VolumeProbe = VolumeEvidence & { days: VolumeDay[] };
export class ExchangeCheckError extends Error {}
type Row = Record<string, any>;
// OKX documents a server error for invitee-list limits of 99 or greater.
const OKX_UID_PAGE_SIZE = "10";
const MEXC_DEPOSIT_WINDOW_LIMIT = 12;
const DAY = 86400000;
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
    if (capability === "VOLUME" && !hasVolumePrerequisites(exchange, this.env))
      throw new ExchangeCheckError("volume_not_verified");
  }
  private remaining(deadline: number): number {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new ExchangeCheckError("operation_budget_exceeded");
    return remaining;
  }
  private bitgetRelay() {
    const { BITGET_RELAY_URL: url, BITGET_RELAY_TOKEN: token } = this.env;
    if (!url && !token) return undefined;
    try {
      const relay = new URL(url ?? "");
      if (
        relay.protocol === "https:" &&
        !relay.username && !relay.password &&
        relay.pathname === "/" && !relay.search && !relay.hash &&
        token && /^[A-Za-z0-9_-]{32,256}$/.test(token)
      ) {
        return { origin: relay.origin, token };
      }
    } catch {
      // A malformed URL fails closed along with other incomplete relay settings.
    }
    throw new ExchangeCheckError("bitget_relay_configuration_invalid");
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
    const relay = exchange === "bitget" ? this.bitgetRelay() : undefined;
    const method = exchange === "bitget" ? "POST" : "GET";
    const body = method === "POST" ? JSON.stringify(values) : "";
    const host = {
      mexc: "https://api.mexc.com",
      bitget: relay?.origin ?? "https://api.bitget.com",
      okx: "https://www.okx.com",
    }[exchange];
    // Calling this.fetcher(...) would bind the Workers global fetch to the client.
    const fetcher = this.fetcher;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.remaining(deadline);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (relay) headers.Authorization = `Bearer ${relay.token}`;
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
      const response = await fetcher(
        host + path + (query ? "?" + query : ""),
        {
          method,
          headers,
          body: body || undefined,
          signal: AbortSignal.timeout(
            Math.min(10000, this.remaining(deadline)),
          ),
          // Cloudflare Workers reject redirect: "error" with a TypeError before
          // sending anything. "manual" returns the 3xx, which is refused below.
          redirect: "manual",
        },
      );
      const result = response.ok ? ((await response.json()) as Row) : null;
      this.remaining(deadline);
      const isRetryable =
        response.status === 429 ||
        response.status >= 500 ||
        (exchange === "okx" && String(result?.code) === "50011");
      if (isRetryable && attempt < 2) {
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
      if (
        !result ||
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
  private async mexcReferral(
    uid: string,
    deadline: number,
    start: number,
    end: number,
  ): Promise<Row | undefined> {
    const result = await this.request(
      "mexc",
      "/api/v3/rebate/affiliate/referral",
      { uid, page: "1", pageSize: "10", startTime: String(start), endTime: String(end - 1) },
      deadline,
    );
    const data = result.data;
    const rows = this.scoped(data?.resultList, uid);
    if (
      Number(data.totalCount ?? rows.length) !== rows.length ||
      ![0, 1].includes(Number(data.totalPage ?? 1)) ||
      Number(data.currentPage ?? 1) !== 1
    )
      throw new ExchangeCheckError("pagination_incomplete");
    if (rows.length > 1) throw new ExchangeCheckError("ambiguous_account");
    return rows[0];
  }
  private async mexcAdmission(uid: string, deadline: number): Promise<AdmissionEvidence> {
    const today = Date.parse(completedVolumeWindow(this.now, "mexc").end);
    let start = today - 29 * DAY;
    const latest = await this.mexcReferral(uid, deadline, start, this.now.getTime() + 1);
    if (!latest) return { referral: false, cumulative: "0", complete: false, events: [] };

    let cumulative = sumAmounts([String(latest.depositAmount)]);
    const registration = Number(latest.registerTime ?? latest.inviteTime);
    for (
      let window = 1;
      window < MEXC_DEPOSIT_WINDOW_LIMIT &&
      !(registration > 0 && registration >= start && registration <= this.now.getTime()) &&
      !amountAtLeast(cumulative, MINIMUM_DEPOSIT_USDT);
      window++
    ) {
      const end = start;
      start -= 30 * DAY;
      try {
        const older = await this.mexcReferral(uid, deadline, start, end);
        if (!older) break;
        cumulative = sumAmounts([cumulative, String(older.depositAmount)]);
      } catch {
        // A later query failure must not erase the already-proven deposit lower bound.
        break;
      }
    }
    // The affiliate API reports gross deposits per window without guaranteeing lifetime coverage.
    return { referral: true, cumulative, complete: false, events: [] };
  }
  async admission(exchange: Exchange, uid: string): Promise<AdmissionEvidence> {
    const deadline = Date.now() + 120000;
    this.require(exchange, "ADMISSION");
    if (!/^\d{1,32}$/.test(uid)) throw new ExchangeCheckError("invalid_uid");
    if (exchange === "mexc") return this.mexcAdmission(uid, deadline);
    if (exchange === "okx") {
      // Detail does not always echo the UID: prove its unique affiliate scope first.
      const listed = await this.request(
        exchange,
        "/api/v5/affiliate/invitee/list",
        { uid, page: "1", limit: OKX_UID_PAGE_SIZE },
        deadline,
      );
      const matches = this.scoped(listed.data, uid),
        pages = Number(listed.totalPage ?? 1);
      // OKX answers a UID outside our invitees with an empty list and zero
      // pages. That is a definite "not referred", not an incomplete read.
      if (matches.length === 0 && (pages === 0 || pages === 1))
        return { referral: false, cumulative: "0", complete: true, events: [] };
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
    this.require(exchange, "VOLUME");
    const { days: _days, ...evidence } = await this.readVolume(
      exchange,
      uid,
      window,
    );
    return evidence;
  }
  /**
   * Read-only operator diagnostic: the same query as `volume` without the
   * capability gates, plus the per-day rows. Never used to grant a tier.
   */
  async probeVolume(
    exchange: Exchange,
    uid: string,
    window: { start: string; end: string },
  ): Promise<VolumeProbe> {
    return this.readVolume(exchange, uid, window);
  }
  private async readVolume(
    exchange: Exchange,
    uid: string,
    window: { start: string; end: string },
  ): Promise<VolumeProbe> {
    const deadline = Date.now() + 120000;
    if (!/^\d{1,32}$/.test(uid)) throw new ExchangeCheckError("invalid_uid");
    const start = Date.parse(window.start),
      end = Date.parse(window.end);
    if (!Number.isFinite(start) || end - start !== 30 * DAY)
      throw new ExchangeCheckError("invalid_window");
    if (exchange === "okx" && start % DAY !== 0)
      throw new ExchangeCheckError("invalid_window");
    if (exchange === "mexc") {
      if ((start + 8 * 3600000) % DAY !== 0)
        throw new ExchangeCheckError("invalid_window");
      const row = await this.mexcReferral(uid, deadline, start, end);
      if (!row) throw new ExchangeCheckError("incomplete_volume_window");
      // tradingAmount is the affiliate API's USDT total for this UID and period.
      // The API does not return a reliable spot/futures breakdown here.
      let reportedTotal: string;
      try {
        reportedTotal = sumAmounts([String(row.tradingAmount)]);
      } catch {
        throw new ExchangeCheckError("invalid_volume_amount");
      }
      return { spot: null, futures: null, reportedTotal, days: [] };
    }
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
      // The daily total also covers on-chain, CFD and stock trades, which count
      // toward the threshold. A total below spot + futures is still inconsistent.
      const others = rows.map((row) =>
        amountRemainder(String(row.volumn), [
          String(row.spotVolume),
          String(row.futuresVolume),
        ]),
      );
      if (others.some((value) => value === null))
        throw new ExchangeCheckError("volume_total_mismatch");
      const other = sumAmounts(others as string[]);
      return {
        spot: sumAmounts(rows.map((row) => String(row.spotVolume))),
        futures: sumAmounts(rows.map((row) => String(row.futuresVolume))),
        ...(other !== "0" ? { other } : {}),
        days: rows
          .map((row) => ({
            time: Number(row.time),
            spot: sumAmounts([String(row.spotVolume)]),
            futures: sumAmounts([String(row.futuresVolume)]),
            total: sumAmounts([String(row.volumn)]),
          }))
          .sort((a, b) => a.time - b.time),
      };
    }
    const totals: string[] = [];
    for (const category of ["SPOT", "DERIVATIVE"]) {
      const result = await this.request(
        exchange,
        "/api/v5/affiliate/invitee/list",
        {
          uid,
          page: "1",
          limit: OKX_UID_PAGE_SIZE,
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
      // The list endpoint scopes totalVol to its requested periodType.
      totals.push(sumAmounts([String(rows[0].totalVol)]));
    }
    return { spot: totals[0], futures: totals[1], days: [] };
  }
}
