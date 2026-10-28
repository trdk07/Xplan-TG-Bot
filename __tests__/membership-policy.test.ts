import { describe, expect, it } from "vitest";
import { resolveLegacyStatus } from "@/lib/membership-policy";
import { memberStatuses, isMemberStatus, memberStatusLabel } from "@/lib/status";
import { mapNotionPageToMember, buildNotionProperties } from "@/lib/notion";
const now = new Date("2026-10-22T00:00:00Z");
const base = { status: "sent_7day_survey", paidAt: null, subscriptionMonths: null, groupJoinedAt: "2026-10-01T00:00:00Z", reviewDueAt: "2026-10-31T00:00:00Z" } as any;
describe("membership lifecycle compatibility", () => {
  it("reads legacy and v2 statuses and no notification statuses for writes", () => {
    expect(memberStatuses).toHaveLength(15);
    for (const status of ["invite_sent", "sent_7day_survey", "sent_3day_offer", "user_refused", "renewal_due"]) expect(isMemberStatus(status)).toBe(false);
    expect(memberStatusLabel("expired")).toBe("已到期");
    expect(memberStatusLabel("kicked")).toBe("已停用");
  });
  it("recovers trial and evidenced current paid terms separately", () => {
    expect(resolveLegacyStatus(base, now)).toEqual({ status: "trial_active", needsReview: false });
    expect(resolveLegacyStatus({ ...base, paidAt: "2026-10-01T00:00:00Z", subscriptionMonths: 1 }, now)).toEqual({ status: "active_paid", needsReview: false });
  });
  it("does not infer a current paid term from a historical payment", () => {
    expect(resolveLegacyStatus({ ...base, paidAt: "2026-01-01T00:00:00Z", subscriptionMonths: 1 }, now)).toEqual({ status: "sent_7day_survey", needsReview: true });
    expect(resolveLegacyStatus({ ...base, groupJoinedAt: null }, now).needsReview).toBe(true);
  });
  it("expires legacy terms regardless of whether original tier is known", () => {
    expect(resolveLegacyStatus({ ...base, paidAt: "invalid", reviewDueAt: now.toISOString() }, now)).toEqual({ status: "expired", needsReview: false });
    expect(resolveLegacyStatus({ ...base, status: "invite_sent" }, now).status).toBe("join_pending");
  });
  it("preserves legacy values for review and fails closed for unknown/empty values", () => {
    const read = (value: string) => mapNotionPageToMember({ id:"p",properties:{ Status:{select:{name:value}} }});
    expect(read("sent_3day_offer").status).toBe("sent_3day_offer");
    expect(read("unknown").status).toBe("denied");
    expect(read("").status).toBe("denied");
  });
  it("maps independent reminder timestamps and reports schema availability", () => {
    const properties = {
      "Renewal Reminder Sent At": {type:"date",date:{start:"2026-10-24T00:00:00Z"}},
      "Renewal Reminder 3 Day Sent At": {type:"date",date:{start:"2026-10-28T00:00:00Z"}},
      "Renewal Reminder Due At": {type:"date",date:{start:"2026-10-31T00:00:00Z"}},
    };
    expect(mapNotionPageToMember({id:"p",properties})).toMatchObject({renewalReminder3DaySentAt:"2026-10-28T00:00:00Z",renewalReminderDueAt:"2026-10-31T00:00:00Z",reminderFieldsAvailable:true});
    expect(mapNotionPageToMember({id:"p",properties:{}}).reminderFieldsAvailable).toBe(false);
    expect(buildNotionProperties({renewalReminder3DaySentAt:null,renewalReminderDueAt:null})).toEqual({"Renewal Reminder 3 Day Sent At":{date:null},"Renewal Reminder Due At":{date:null}});
  });
});
