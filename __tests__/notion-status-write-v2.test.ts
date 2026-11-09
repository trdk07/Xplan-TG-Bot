import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v2Statuses } from "@/lib/membership-v2";

const mocks = vi.hoisted(() => ({ update: vi.fn(), retrieve: vi.fn() }));
vi.mock("@/lib/config", () => ({
  getRuntimeConfig: () => ({ notionApiKey: "test-only" }),
}));
vi.mock("@notionhq/client", () => ({ Client: class { pages = mocks; } }));

import {
  buildNotionProperties,
  mapNotionPageToMember,
  updateMember,
  updateMemberExistingProperties,
} from "@/lib/notion";

const legacyStatuses = [
  "eligible", "collecting_info", "invite_sent", "join_pending", "trial_active",
  "renewal_due", "payment_pending", "expired", "kicked", "denied",
  "sent_7day_survey", "sent_3day_offer", "user_refused",
] as const;

describe("V2 Notion Status write boundary", () => {
  beforeEach(() => {
    vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "true");
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({});
    mocks.retrieve.mockResolvedValue({ properties: { Status: { type: "select" } } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(v2Statuses)("writes the canonical %s Status", (status) => {
    expect(buildNotionProperties({ status })).toEqual({ Status: { select: { name: status } } });
  });

  it.each([...legacyStatuses, "unrecognized-status", ""])(
    "rejects %s before a legacy option can be recreated",
    (status) => {
      expect(() => buildNotionProperties({ status: status as any })).toThrow(/V2.*status/i);
    },
  );

  it("blocks both update APIs before sending a legacy Status to Notion", async () => {
    await expect(updateMember("page", { status: "trial_active" })).rejects.toThrow(/V2.*status/i);
    await expect(updateMemberExistingProperties("page", { status: "expired" })).rejects.toThrow(/V2.*status/i);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("continues reading legacy records for review without writing their status", () => {
    const member = mapNotionPageToMember({ id: "old-page", properties: { Status: { select: { name: "trial_active" } } } });
    expect(member.status).toBe("trial_active");
    expect(buildNotionProperties({ renewalReminderSentAt: null })).toEqual({ "Renewal Reminder Sent At": { date: null } });
  });

  it("retains explicitly disabled V1 compatibility", () => {
    vi.stubEnv("MEMBERSHIP_POLICY_V2_ENABLED", "false");
    expect(buildNotionProperties({ status: "trial_active" })).toEqual({ Status: { select: { name: "trial_active" } } });
  });
});
