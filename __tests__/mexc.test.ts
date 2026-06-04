import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  getRuntimeConfig: () => ({
    telegramBotToken: "token",
    telegramWebhookSecret: "secret",
    telegramGroupId: "-100",
    notionApiKey: "notion",
    notionDataSourceId: "source",
    adminPassword: "pw",
    appBaseUrl: "https://app.test",
    exchangeName: "X-Plan",
    teacherTelegramUid: "1222518302",
    trialDays: 30,
    paymentGraceDays: 3,
    jobSecret: "job",
    mexcApiBaseUrl: "https://api.mexc.test",
    mexcApiAccessKey: "access-key",
    mexcApiSecretKey: "secret-key",
    mexcAffiliateEndpoint: "/api/v3/rebate/affiliate/referral",
    mexcAffiliateUidParam: "uid",
    mexcAffiliateMemberInfo: "",
    mexcAffiliateLookbackDays: 365,
    mexcMinDepositUsdt: 100,
  }),
}));

import { getMexcDirectSubaffiliate } from "@/lib/mexc";

describe("MEXC affiliate client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
  });

  it("queries subordinate data by UID and extracts deposit amount", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      expect(parsed.origin).toBe("https://api.mexc.test");
      expect(parsed.pathname).toBe("/api/v3/rebate/affiliate/referral");
      expect(parsed.searchParams.get("uid")).toBe("987654321");
      expect(parsed.searchParams.has("inviteCode")).toBe(false);
      expect(parsed.searchParams.get("signature")).toBeTruthy();
      expect(init?.headers).toMatchObject({
        "X-MEXC-APIKEY": "access-key",
      });

      return new Response(
        JSON.stringify({
          code: 200,
          msg: "success",
          data: {
            data: [
              {
                uid: "987654321",
                totalDepositAmount: "120.50",
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const referral = await getMexcDirectSubaffiliate("987654321");

    expect(referral).toMatchObject({
      uid: "987654321",
      depositAmount: "120.50",
    });
  });
});
