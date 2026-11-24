import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { ExchangeClient, totalVolume } from "@/lib/exchanges";
import { amountAtLeast, completedVolumeWindow, VOLUME_THRESHOLD_USDT } from "@/lib/membership-v2";
const now = new Date("2026-10-28T01:00:00Z");
const env = {
  BITGET_API_KEY: "unit",
  BITGET_API_SECRET_KEY: "secret",
  BITGET_API_PASSPHRASE: "phrase",
  BITGET_ADMISSION_ENABLED: "true",
  BITGET_VOLUME_ENABLED: "true",
  BITGET_VOLUME_UNIT_VERIFIED: "true",
  BITGET_VOLUME_COVERAGE_VERIFIED: "true",
  BITGET_VOLUME_WINDOW_VERIFIED: "true",
};
describe("exchange-qualified evidence", () => {
  it("refuses unverified turnover capability instead of returning zero", async () => {
    const client = new ExchangeClient(
      { ...env, BITGET_VOLUME_UNIT_VERIFIED: "false", BITGET_VOLUME_USE_REPORTED_TOTALS: "true" },
      vi.fn(),
      now,
    );
    await expect(
      client.volume("bitget", "123", completedVolumeWindow(now)),
    ).rejects.toThrow("volume_not_verified");
  });
  it.each([false, true])("signs UID-scoped Bitget requests and preserves deposit events (relay: %s)", async (useRelay) => {
    const token = "test_bitget_relay_token_for_affiliate";
    const origin = useRelay ? "https://relay.example" : "https://api.bitget.com";
    const config = useRelay ? { ...env, BITGET_RELAY_URL: origin, BITGET_RELAY_TOKEN: token } : env;
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers),
          url = new URL(String(input));
        expect(url.origin).toBe(origin);
        expect(headers.get("Authorization")).toBe(useRelay ? `Bearer ${token}` : null);
        expect(init?.redirect).toBe("manual");
        expect(headers.get("ACCESS-SIGN")).toBe(
          createHmac("sha256", env.BITGET_API_SECRET_KEY)
            .update(
              headers.get("ACCESS-TIMESTAMP") +
                "POST" +
                url.pathname +
                String(init?.body),
            )
            .digest("base64"),
        );
        const body = JSON.parse(String(init?.body));
        expect(body.uid).toBe("123");
        if (String(input).endsWith("customer-list"))
          return Response.json({
            code: "00000",
            data: [
              { uid: "123", registerTime: String(now.getTime() - 86400000) },
            ],
          });
        return Response.json({
          code: "00000",
          data: [
            {
              uid: "123",
              orderId: "e1",
              depositCoin: "USDT",
              depositAmount: "100",
              depositTime: String(now.getTime() - 1000),
            },
          ],
        });
      },
    );
    const result = await new ExchangeClient(config, fetcher, now).admission(
      "bitget",
      "123",
    );
    expect(result).toMatchObject({ referral: true, complete: true });
    expect(result.events[0]).toMatchObject({
      id: "e1",
      usdtAmount: "100",
      kind: "deposit",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    { BITGET_RELAY_URL: "https://relay.example" },
    { BITGET_RELAY_TOKEN: "test_bitget_relay_token_for_affiliate" },
    { BITGET_RELAY_URL: "http://relay.example", BITGET_RELAY_TOKEN: "test_bitget_relay_token_for_affiliate" },
    { BITGET_RELAY_URL: "https://relay.example/redirect", BITGET_RELAY_TOKEN: "test_bitget_relay_token_for_affiliate" },
  ])("rejects an incomplete or invalid Bitget relay configuration before fetch", async (config) => {
    const fetcher = vi.fn(async () => Response.json({ code: "00000", data: [] }));
    await expect(
      new ExchangeClient({ ...env, ...config }, fetcher, now).admission("bitget", "123"),
    ).rejects.toThrow("bitget_relay_configuration_invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects foreign-account rows rather than aggregating them", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ code: "00000", data: [{ uid: "999" }] }),
    );
    await expect(
      new ExchangeClient(env, fetcher, now).admission("bitget", "123"),
    ).rejects.toThrow("unexpected_account");
  });
  it("uses the opt-in Bitget report with 30 complete buckets and no full-coverage claim", async () => {
    const window = completedVolumeWindow(now);
    const start = Date.parse(window.start);
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body.startTime).toBe(String(start - 1));
        return Response.json({
          code: "00000",
          data: Array.from({ length: 30 }, (_, i) => ({
            uid: "123",
            time: String(start + i * 86400000),
            spotVolume: "1000",
            futuresVolume: "6000",
            volumn: "7000",
          })),
        });
      },
    );
    const reportedConfig = { ...env, BITGET_VOLUME_COVERAGE_VERIFIED: "false" };
    await expect(new ExchangeClient(reportedConfig, fetcher, now).volume("bitget", "123", window))
      .rejects.toThrow("volume_not_verified");
    expect(
      await new ExchangeClient({
        ...reportedConfig, BITGET_VOLUME_USE_REPORTED_TOTALS: "true",
      }, fetcher, now).volume(
        "bitget",
        "123",
        window,
      ),
    ).toEqual({ spot: "30000", futures: "180000" });
  });
  it("fails incomplete API pagination rather than trusting first-page totals", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        code: "00000",
        data: Array.from({ length: 1000 }, () => ({
          uid: "123",
          registerTime: "1",
        })),
      }),
    );
    await expect(
      new ExchangeClient(env, fetcher, now).admission("bitget", "123"),
    ).rejects.toThrow();
  });
});

const mexcEnv = {
  MEXC_API_ACCESS_KEY: "synthetic",
  MEXC_API_SECRET_KEY: "synthetic",
  MEXC_ADMISSION_ENABLED: "true",
  MEXC_VOLUME_ENABLED: "true",
  MEXC_VOLUME_UNIT_VERIFIED: "true",
  MEXC_VOLUME_WINDOW_VERIFIED: "true",
  MEXC_VOLUME_USE_REPORTED_TOTALS: "true",
};
const mexcReferralResponse = (resultList: Record<string, unknown>[], totalCount = resultList.length) =>
  Response.json({ success: true, code: 0, data: { totalCount, currentPage: 1, totalPage: 1, resultList } });

it.each([
  [1035, "mexc_referral_not_found"],
  [10072, "upstream_rejected"],
] as const)("distinguishes MEXC UID lookups from credential errors (%s)", async (code, expected) => {
  const fetcher = vi.fn(async () =>
    Response.json({ success: false, code, message: null, data: null }),
  );
  const client = new ExchangeClient(mexcEnv, fetcher, now);
  await expect(client.admission("mexc", "123")).rejects.toThrow(expected);
  await expect(client.volume("mexc", "123", completedVolumeWindow(now, "mexc"))).rejects.toThrow(expected);
});

it("requires the explicit MEXC reported-total opt-in, even with the old coverage flag", async () => {
  const fetcher = vi.fn();
  const enabled = { ...mexcEnv, MEXC_VOLUME_USE_REPORTED_TOTALS: "false", MEXC_VOLUME_COVERAGE_VERIFIED: "true" };
  await expect(
    new ExchangeClient(enabled, fetcher, now).volume(
      "mexc",
      "123",
      completedVolumeWindow(now),
    ),
  ).rejects.toThrow("volume_not_verified");
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([["200000", true], ["199999.99", false], ["0", false]])(
  "uses the MEXC affiliate's UID-scoped 30-day total %s with the correct threshold",
  async (tradingAmount, qualified) => {
    const window = completedVolumeWindow(now, "mexc");
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://api.mexc.com/api/v3/rebate/affiliate/referral");
      expect(url.searchParams.get("uid")).toBe("123");
      expect(url.searchParams.get("startTime")).toBe(String(Date.parse(window.start)));
      expect(url.searchParams.get("endTime")).toBe(String(Date.parse(window.end) - 1));
      expect(new Headers(init?.headers).get("X-MEXC-APIKEY")).toBe(mexcEnv.MEXC_API_ACCESS_KEY);
      const signature = url.searchParams.get("signature");
      url.searchParams.delete("signature");
      expect(signature).toBe(createHmac("sha256", mexcEnv.MEXC_API_SECRET_KEY)
        .update(url.searchParams.toString()).digest("hex"));
      return mexcReferralResponse([{ uid: "123", tradingAmount, commission: "1", depositAmount: "2" }]);
    });
    const volume = await new ExchangeClient(mexcEnv, fetcher, now).volume("mexc", "123", window);
    expect(volume).toEqual({ spot: null, futures: null, reportedTotal: tradingAmount });
    expect(amountAtLeast(totalVolume(volume), VOLUME_THRESHOLD_USDT)).toBe(qualified);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it.each([
  [[], 0, "incomplete_volume_window"],
  [[{ uid: "999", tradingAmount: "200000" }], 1, "unexpected_account"],
  [[{ uid: "123", tradingAmount: "200000" }], 2, "pagination_incomplete"],
  [[{ uid: "123", commission: "200000" }], 1, "invalid_volume_amount"],
] as const)("rejects an unusable MEXC trade report (%#)", async (rows, count, error) => {
  const fetcher = vi.fn(async () => mexcReferralResponse([...rows], count));
  await expect(new ExchangeClient(mexcEnv, fetcher, now).volume("mexc", "123", completedVolumeWindow(now, "mexc")))
    .rejects.toThrow(error);
});

it("rejects an OKX UTC day boundary for a MEXC report before fetching", async () => {
  const fetcher = vi.fn();
  await expect(new ExchangeClient(mexcEnv, fetcher, now).volume("mexc", "123", completedVolumeWindow(now, "okx")))
    .rejects.toThrow("invalid_window");
  expect(fetcher).not.toHaveBeenCalled();
});

it("accepts MEXC deposits from nonoverlapping windows without deducting withdrawals", async () => {
  const ranges: { start: number; end: number }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const values = new URL(String(input)).searchParams;
    expect(values.get("uid")).toBe("123");
    const start = Number(values.get("startTime")), end = Number(values.get("endTime"));
    expect(end - start).toBeLessThan(30 * 86400000);
    ranges.push({ start, end });
    return mexcReferralResponse([{
      uid: "123",
      registerTime: now.getTime() - 65 * 86400000,
      depositAmount: ranges.length === 1 ? "40.01" : "59.99",
      withdrawAmount: "1000",
    }]);
  });
  await expect(new ExchangeClient(mexcEnv, fetcher, now).admission("mexc", "123"))
    .resolves.toEqual({ referral: true, cumulative: "100", complete: false, events: [] });
  expect(ranges).toHaveLength(2);
  expect(ranges[0].end).toBe(now.getTime());
  expect(ranges[1].end + 1).toBe(ranges[0].start);
});

it("preserves a MEXC deposit lower bound when an older window is inaccessible", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(mexcReferralResponse([{ uid: "123", registerTime: now.getTime() - 90 * 86400000, depositAmount: "30" }]))
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(new ExchangeClient(mexcEnv, fetcher, now).admission("mexc", "123"))
    .resolves.toEqual({ referral: true, cumulative: "30", complete: false, events: [] });
});

const okxEnv = {
  OKX_API_KEY: "synthetic",
  OKX_API_SECRET_KEY: "synthetic",
  OKX_API_PASSPHRASE: "synthetic",
  OKX_ADMISSION_ENABLED: "true",
};
it("verifies the exact OKX UID on invitee/list before accepting detail deposit evidence", async () => {
  const paths: string[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input)),
        headers = new Headers(init?.headers);
      paths.push(url.pathname);
      expect(url.searchParams.get("uid")).toBe("123");
      if (url.pathname.endsWith("/list")) {
        expect(Number(url.searchParams.get("limit"))).toBeLessThan(99);
      }
      expect(headers.get("OK-ACCESS-SIGN")).toBe(
        createHmac("sha256", okxEnv.OKX_API_SECRET_KEY)
          .update(
            headers.get("OK-ACCESS-TIMESTAMP") +
              "GET" +
              url.pathname +
              url.search,
          )
          .digest("base64"),
      );
      return Response.json({
        code: "0",
        data: url.pathname.endsWith("/list")
          ? [{ uid: "123" }]
          : [{ inviteeLevel: "2", depAmt: "100" }],
        totalPage: "1",
      });
    },
  );
  expect(
    await new ExchangeClient(okxEnv, fetcher, now).admission("okx", "123"),
  ).toMatchObject({ referral: true, cumulative: "100" });
  expect(paths).toEqual([
    "/api/v5/affiliate/invitee/list",
    "/api/v5/affiliate/invitee/detail",
  ]);
});

it("reads opted-in OKX reports for complete UTC days and retries business-code rate limits", async () => {
  const window = { start: "2026-09-28T00:00:00.000Z", end: "2026-10-28T00:00:00.000Z" };
  const categories: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    expect(url.searchParams.get("uid")).toBe("123");
    expect(url.searchParams.get("periodType")).toBe("custom");
    expect(url.searchParams.get("begin")).toBe(String(Date.parse(window.start)));
    expect(url.searchParams.get("end")).toBe(String(Date.parse(window.end) - 1));
    const category = url.searchParams.get("commissionCategory")!;
    categories.push(category);
    if (categories.length === 1) {
      return Response.json({ code: "50011" }, { headers: { "Retry-After": "0" } });
    }
    expect(Number(url.searchParams.get("limit"))).toBeLessThan(99);
    return Response.json({
      code: "0",
      totalPage: "1",
      data: [{ uid: "123", totalVol: category === "SPOT" ? "50000.01" : "149999.99" }],
    });
  });
  const configured = {
    ...okxEnv, OKX_VOLUME_ENABLED: "true", OKX_VOLUME_UNIT_VERIFIED: "true",
    OKX_VOLUME_WINDOW_VERIFIED: "true", OKX_VOLUME_COVERAGE_VERIFIED: "false",
    OKX_VOLUME_USE_REPORTED_TOTALS: "true",
  };
  const client = new ExchangeClient(configured, fetcher, now);
  await expect(client.volume("okx", "123", completedVolumeWindow(now, "bitget")))
    .rejects.toThrow("invalid_window");
  await expect(client.volume("okx", "123", window))
    .resolves.toMatchObject({ spot: "50000.01", futures: "149999.99" });
  expect(categories).toEqual(["SPOT", "SPOT", "DERIVATIVE"]);
});

it.each([
  { data: [{ uid: "999" }], totalPage: "1" },
  { data: [{ uid: "123" }, { uid: "123" }], totalPage: "1" },
  { data: [{ uid: "123" }], totalPage: "2" },
])(
  "does not fetch OKX detail when UID uniqueness or complete list scope is unproven: %j",
  async (result) => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      Response.json({
        code: "0",
        ...result,
        ...(String(input).includes("/detail")
          ? { data: [{ inviteeLevel: "2", depAmt: "100" }] }
          : {}),
      }),
    );
    await expect(
      new ExchangeClient(okxEnv, fetcher, now).admission("okx", "123"),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toContain("/invitee/list");
  },
);

it.each(["100", "99.99"])(
  "retains a validated partial Bitget chunk of %s for qualification after later history fails",
  async (amount) => {
    const { checkQualifications } = await import("@/lib/qualification");
    const { sumAmounts } = await import("@/lib/membership-v2");
    let chunk = 0;
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("customer-list"))
          return Response.json({
            code: "00000",
            data: [{ uid: "123", registerTime: "1" }],
          });
        const body = JSON.parse(String(init?.body));
        if (++chunk === 1)
          return Response.json({
            code: "00000",
            data: [
              {
                uid: "123",
                orderId: "proven-deposit",
                depositCoin: "USDT",
                depositAmount: amount,
                depositTime: String(Number(body.startTime) + 1),
              },
            ],
          });
        return new Response(null, { status: 400 });
      },
    );
    const client = new ExchangeClient(env, fetcher, now);
    const evidence = await client.admission("bitget", "123");
    expect(evidence).toMatchObject({
      referral: true,
      complete: false,
      events: [{ id: "proven-deposit", usdtAmount: amount }],
    });
    const member = {
      pageId: "p",
      status: "free",
      exchangeName: "Bitget",
      exchangeUid: "123",
      admissionVerifiedAt: null,
      qualificationFieldsAvailable: true,
    };
    let ledger: string[] = [];
    const result = await checkQualifications(
      "p",
      {
        read: async () => member,
        list: async () => [member],
        write: async () => {},
        store: {
          recordTransition: async () => {},
          withQualificationLock: async (_id: string, work: any) =>
            work(async () => {}),
          reserveAccount: async () => {},
          recordDeposits: async (
            _exchange: string,
            _uid: string,
            events: typeof evidence.events,
          ) => {
            ledger = events.flatMap((e) =>
              e.usdtAmount === null ? [] : [e.usdtAmount],
            );
          },
          depositTotal: async () => sumAmounts(ledger),
        },
        client: {
          admission: async () => evidence,
          volume: async () => {
            throw Error("must not request volume");
          },
        },
      } as any,
      now,
      true,
    );
    expect(result.onboardingStep).toBe(
      amount === "100" ? "eligible" : "needs_review",
    );
    expect(Boolean(result.admissionVerifiedAt)).toBe(amount === "100");
  },
);

it("preserves validated deposit pages when a later page fails within one Bitget history chunk", async () => {
  const { sumAmounts } = await import("@/lib/membership-v2");
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("customer-list"))
        return Response.json({
          code: "00000",
          data: [{ uid: "123", registerTime: "1" }],
        });
      const body = JSON.parse(String(init?.body));
      if (body.pageNo === "1")
        return Response.json({
          code: "00000",
          data: Array.from({ length: 1000 }, (_, i) => ({
            uid: "123",
            orderId: String(i + 1),
            depositCoin: "USDT",
            depositAmount: "0.1",
            depositTime: String(Number(body.startTime) + 1),
          })),
        });
      return new Response(null, { status: 400 });
    },
  );
  const evidence = await new ExchangeClient(env, fetcher, now).admission(
    "bitget",
    "123",
  );
  expect(evidence.complete).toBe(false);
  expect(evidence.events).toHaveLength(1000);
  expect(sumAmounts(evidence.events.map((e) => e.usdtAmount!))).toBe("100");
});

it("continues to reject partial Bitget volume windows", async () => {
  const window = completedVolumeWindow(now),
    start = Date.parse(window.start);
  const fetcher = vi.fn(async () =>
    Response.json({
      code: "00000",
      data: Array.from({ length: 29 }, (_, i) => ({
        uid: "123",
        time: String(start + i * 86400000),
        spotVolume: "100000",
        futuresVolume: "100000",
        volumn: "200000",
      })),
    }),
  );
  await expect(
    new ExchangeClient(env, fetcher, now).volume("bitget", "123", window),
  ).rejects.toThrow("incomplete_volume_window");
});

it("never treats a future Bitget registration timestamp as complete historical evidence", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    Response.json({
      code: "00000",
      data: String(input).endsWith("customer-list")
        ? [{ uid: "123", registerTime: String(now.getTime() + 86400000) }]
        : [],
    }),
  );
  expect(
    await new ExchangeClient(env, fetcher, now).admission("bitget", "123"),
  ).toMatchObject({ referral: true, complete: false, events: [] });
});

it("regenerates the timestamp and exact HMAC after a bounded Retry-After delay", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  try {
    const attempts: { timestamp: string | null; signature: string | null }[] =
      [];
    const window = completedVolumeWindow(now),
      start = Date.parse(window.start);
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers),
          url = new URL(String(input));
        expect(headers.get("ACCESS-SIGN")).toBe(
          createHmac("sha256", env.BITGET_API_SECRET_KEY)
            .update(
              headers.get("ACCESS-TIMESTAMP") +
                "POST" +
                url.pathname +
                String(init?.body),
            )
            .digest("base64"),
        );
        attempts.push({
          timestamp: headers.get("ACCESS-TIMESTAMP"),
          signature: headers.get("ACCESS-SIGN"),
        });
        if (attempts.length === 1)
          return new Response(null, {
            status: 429,
            headers: { "Retry-After": "1" },
          });
        return Response.json({
          code: "00000",
          data: Array.from({ length: 30 }, (_, i) => ({
            uid: "123",
            time: String(start + i * 86400000),
            spotVolume: "1000",
            futuresVolume: "6000",
            volumn: "7000",
          })),
        });
      },
    );
    const result = new ExchangeClient(env, fetcher, now).volume(
      "bitget",
      "123",
      window,
    );
    await vi.waitFor(() =>
      expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(1),
    );
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ spot: "30000", futures: "180000" });
    expect(Number(attempts[1]!.timestamp)).toBeGreaterThan(
      Number(attempts[0]!.timestamp),
    );
    expect(attempts[1]!.signature).not.toBe(attempts[0]!.signature);
  } finally {
    vi.useRealTimers();
  }
});

it("rejects a volume operation once its two-minute total budget is exhausted", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  try {
    const window = completedVolumeWindow(now),
      start = Date.parse(window.start);
    const fetcher = vi.fn(async () => {
      vi.setSystemTime(Date.now() + 120001);
      return Response.json({
        code: "00000",
        data: Array.from({ length: 30 }, (_, i) => ({
          uid: "123",
          time: String(start + i * 86400000),
          spotVolume: "10000",
          futuresVolume: "0",
          volumn: "10000",
        })),
      });
    });
    await expect(
      new ExchangeClient(env, fetcher, now).volume("bitget", "123", window),
    ).rejects.toThrow("operation_budget_exceeded");
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("resets the two-minute budget for each sequential call on the reused exchange client", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  try {
    const window = completedVolumeWindow(now),
      start = Date.parse(window.start);
    const fetcher = vi.fn(async () => {
      vi.setSystemTime(Date.now() + 70000);
      return Response.json({
        code: "00000",
        data: Array.from({ length: 30 }, (_, i) => ({
          uid: "123",
          time: String(start + i * 86400000),
          spotVolume: "10000",
          futuresVolume: "0",
          volumn: "10000",
        })),
      });
    });
    const client = new ExchangeClient(env, fetcher, now);
    expect(await client.volume("bitget", "123", window)).toEqual({
      spot: "300000",
      futures: "0",
    });
    expect(await client.volume("bitget", "123", window)).toEqual({
      spot: "300000",
      futures: "0",
    });
  } finally {
    vi.useRealTimers();
  }
});

describe("turnover beyond spot and futures, and the read-only probe", () => {
  const window = completedVolumeWindow(now),
    start = Date.parse(window.start);
  const rows = (volumn: string) =>
    vi.fn(async () =>
      Response.json({
        code: "00000",
        data: Array.from({ length: 30 }, (_, i) => ({
          uid: "123",
          time: String(start + i * 86400000),
          spotVolume: "1000",
          futuresVolume: "5000",
          volumn,
        })),
      }),
    );
  it("counts on-chain, CFD and stock turnover reported in the daily total", async () => {
    expect(
      await new ExchangeClient(env, rows("7500.5"), now).volume("bitget", "123", window),
    ).toEqual({ spot: "30000", futures: "150000", other: "45015" });
  });
  it("still rejects a daily total below spot plus futures", async () => {
    await expect(
      new ExchangeClient(env, rows("5999"), now).volume("bitget", "123", window),
    ).rejects.toThrow("volume_total_mismatch");
  });
  it("probes with the capability gates off and returns the daily rows", async () => {
    const gated = { ...env, BITGET_VOLUME_ENABLED: "false", BITGET_VOLUME_UNIT_VERIFIED: "false" };
    await expect(
      new ExchangeClient(gated, rows("6000"), now).volume("bitget", "123", window),
    ).rejects.toThrow("volume_disabled");
    const probe = await new ExchangeClient(gated, rows("6000"), now).probeVolume("bitget", "123", window);
    expect(probe).toMatchObject({ spot: "30000", futures: "150000" });
    expect(probe.days).toHaveLength(30);
    expect(probe.days[0]).toEqual({ time: start, spot: "1000", futures: "5000", total: "6000" });
  });
});

describe("Cloudflare Workers fetch compatibility", () => {
  it("calls an injected global fetch without binding it to ExchangeClient", async () => {
    const fetcher: typeof fetch = async function (this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation: function called with incorrect this reference");
      }
      return Response.json({ code: "00000", data: [] });
    };
    await expect(new ExchangeClient(env, fetcher, now).admission("bitget", "123"))
      .resolves.toMatchObject({ referral: false });
  });

  it("never asks for redirect: \"error\", which the Workers runtime refuses", async () => {
    const window = completedVolumeWindow(now),
      start = Date.parse(window.start);
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return Response.json({
        code: "00000",
        data: Array.from({ length: 30 }, (_, i) => ({
          uid: "123",
          time: String(start + i * 86400000),
          spotVolume: "1",
          futuresVolume: "1",
          volumn: "2",
        })),
      });
    });
    await new ExchangeClient(env, fetcher, now).volume("bitget", "123", window);
    expect(fetcher).toHaveBeenCalled();
  });
  it("refuses a redirected exchange response instead of following it", async () => {
    const fetcher = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }),
    );
    await expect(
      new ExchangeClient(env, fetcher, now).admission("bitget", "123"),
    ).rejects.toThrow("upstream_http_302");
  });
});

describe("OKX UID outside our invitees", () => {
  const list = (body: unknown) => vi.fn(async () => Response.json({ code: "0", ...(body as object) }));
  it.each([{ data: [], totalPage: "0" }, { data: [], totalPage: "1" }, { data: [] }])(
    "treats an empty invitee list as not referred: %j",
    async (body) => {
      const fetcher = list(body);
      expect(
        await new ExchangeClient(okxEnv, fetcher, now).admission("okx", "123"),
      ).toEqual({ referral: false, cumulative: "0", complete: true, events: [] });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("still refuses a list that spans several pages", async () => {
    await expect(
      new ExchangeClient(okxEnv, list({ data: [], totalPage: "3" }), now).admission("okx", "123"),
    ).rejects.toThrow("pagination_incomplete");
    await expect(
      new ExchangeClient(okxEnv, list({ data: [{ uid: "123" }], totalPage: "2" }), now).admission("okx", "123"),
    ).rejects.toThrow("pagination_incomplete");
  });
});

describe("OKX admission diagnostic", () => {
  it("shows the raw list and detail answers, including a business rejection, without throwing", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      Response.json(
        String(input).includes("/invitee/detail")
          ? { code: "51621", msg: "The user isn't your invitee", data: [] }
          : { code: "0", msg: "", data: [], totalPage: "0" },
      ),
    );
    // Works with the admission gate off: it is a diagnostic, not a decision.
    const lines = await new ExchangeClient(
      { ...okxEnv, OKX_ADMISSION_ENABLED: "false" },
      fetcher,
      now,
    ).diagnoseAdmission("okx", "123");
    const text = lines.join("\n");
    expect(text).toContain('totalPage="0"');
    expect(text).toContain("名單中有這個 UID：沒有");
    expect(text).toContain('code="51621"');
    expect(text).toContain("The user isn't your invitee");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("shows the invitee's level and deposit when OKX returns a detail row", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      Response.json(
        String(input).includes("/invitee/detail")
          ? { code: "0", data: [{ inviteeLevel: "2", depAmt: "120", joinTime: "1763700000000" }] }
          : { code: "0", data: [], totalPage: "0" },
      ),
    );
    const text = (await new ExchangeClient(okxEnv, fetcher, now).diagnoseAdmission("okx", "123")).join("\n");
    expect(text).toContain('inviteeLevel="2"');
    expect(text).toContain('depAmt="120"');
  });
  it("leaves the real admission check strict about business rejections", async () => {
    const fetcher = vi.fn(async () => Response.json({ code: "51621", msg: "x", data: [] }));
    await expect(
      new ExchangeClient(okxEnv, fetcher, now).admission("okx", "123"),
    ).rejects.toThrow("upstream_rejected");
  });
});
