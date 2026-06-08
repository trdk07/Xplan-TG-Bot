import { describe, expect, it } from "vitest";
import { isStartCommand } from "@/lib/bot";
import {
  activeGroupStatuses,
  blockedEntryStatuses,
  isMemberStatus,
  memberStatusLabel,
} from "@/lib/status";

describe("member status policy", () => {
  it("recognizes valid status values", () => {
    expect(isMemberStatus("eligible")).toBe(true);
    expect(isMemberStatus("not_real")).toBe(false);
  });

  it("separates active group statuses from blocked statuses", () => {
    expect(activeGroupStatuses.has("trial_active")).toBe(true);
    expect(activeGroupStatuses.has("active_paid")).toBe(true);
    expect(activeGroupStatuses.has("partner")).toBe(true);
    expect(activeGroupStatuses.has("exempt")).toBe(true);
    expect(activeGroupStatuses.has("VIP")).toBe(true);
    expect(blockedEntryStatuses.has("expired")).toBe(true);
    expect(blockedEntryStatuses.has("denied")).toBe(true);
  });

  it("recognizes Telegram start command variants", () => {
    expect(isStartCommand("/start")).toBe(true);
    expect(isStartCommand("/start abc")).toBe(true);
    expect(isStartCommand("/start@bibibi_admin_bot")).toBe(true);
    expect(isStartCommand("start")).toBe(false);
    expect(isStartCommand("/restart")).toBe(false);
  });

  it("provides Chinese labels for admin status display", () => {
    expect(memberStatusLabel("eligible")).toBe("可入群");
    expect(memberStatusLabel("payment_pending")).toBe("待付款");
    expect(memberStatusLabel("partner")).toBe("合作夥伴");
    expect(memberStatusLabel("exempt")).toBe("免費會員");
    expect(memberStatusLabel("VIP")).toBe("VIP");
    expect(memberStatusLabel("kicked")).toBe("已離開");
  });
});
