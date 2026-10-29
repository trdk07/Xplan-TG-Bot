import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { ExchangeClient } from "@/lib/exchanges";
import { completedVolumeWindow } from "@/lib/membership-v2";
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
      { ...env, BITGET_VOLUME_UNIT_VERIFIED: "false" },
      vi.fn(),
      now,
    );
    await expect(
      client.volume("bitget", "123", completedVolumeWindow(now)),
    ).rejects.toThrow("volume_not_verified");
  });
  it("signs UID-scoped Bitget requests and preserves deposit events for dedupe", async () => {
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
    const result = await new ExchangeClient(env, fetcher, now).admission(
      "bitget",
      "123",
    );
    expect(result).toMatchObject({ referral: true, complete: true });
    expect(result.events[0]).toMatchObject({
      id: "e1",
      usdtAmount: "100",
      kind: "deposit",
    });
  });
  it("rejects foreign-account rows rather than aggregating them", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ code: "00000", data: [{ uid: "999" }] }),
    );
    await expect(
      new ExchangeClient(env, fetcher, now).admission("bitget", "123"),
    ).rejects.toThrow("unexpected_account");
  });
  it("requires exactly30 completed daily Bitget buckets and correct sum", async () => {
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
    expect(
      await new ExchangeClient(env, fetcher, now).volume(
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

it("never queries MEXC commission-eligible volume even when every operator gate is enabled", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    return Response.json({
      code: "0",
      data: {
        totalCount: 1,
        totalTradeUsdtAmount: "100000",
        resultList: [
          { uid: "123", sourceType: "1", type: url.searchParams.get("type") },
        ],
      },
    });
  });
  const enabled = {
    MEXC_API_KEY: "synthetic",
    MEXC_API_SECRET_KEY: "synthetic",
    MEXC_VOLUME_ENABLED: "true",
    MEXC_VOLUME_UNIT_VERIFIED: "true",
    MEXC_VOLUME_COVERAGE_VERIFIED: "true",
    MEXC_VOLUME_WINDOW_VERIFIED: "true",
  };
  await expect(
    new ExchangeClient(enabled, fetcher, now).volume(
      "mexc",
      "123",
      completedVolumeWindow(now),
    ),
  ).rejects.toThrow("full_turnover_unavailable");
  expect(fetcher).not.toHaveBeenCalled();
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
