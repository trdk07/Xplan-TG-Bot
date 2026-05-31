import { describe, expect, it } from "vitest";
import {
  buildNotionProperties,
  mapNotionPageToMember,
  normalizeExchangeUid,
  normalizeTelegramUsername,
  notionProperties,
} from "@/lib/notion";

describe("Notion member mapping", () => {
  it("maps Notion page properties into a member model", () => {
    const member = mapNotionPageToMember({
      id: "page-1",
      properties: {
        [notionProperties.telegramUserId]: {
          rich_text: [{ plain_text: "12345" }],
        },
        [notionProperties.telegramUsername]: {
          rich_text: [{ plain_text: "@aceon" }],
        },
        [notionProperties.email]: { email: "student@example.com" },
        [notionProperties.status]: { select: { name: "trial_active" } },
        [notionProperties.tags]: {
          multi_select: [{ name: "翻倉成功" }],
        },
        [notionProperties.exchangeRegistered]: { checkbox: true },
        [notionProperties.exchangeName]: { rich_text: [{ plain_text: "MEXC" }] },
        [notionProperties.exchangeUid]: { rich_text: [{ plain_text: "UID-1" }] },
        [notionProperties.invitationEmailSent]: { checkbox: true },
        [notionProperties.paymentUidLast4]: { rich_text: [{ plain_text: "1234" }] },
        [notionProperties.paymentProofFileId]: {
          rich_text: [{ plain_text: "photo-file-id" }],
        },
        [notionProperties.paymentProofSubmittedAt]: {
          date: { start: "2026-05-01T00:00:00.000Z" },
        },
        [notionProperties.finalPnl]: { rich_text: [{ plain_text: "+20%" }] },
        [notionProperties.renewalStep]: {
          select: { name: "awaiting_pnl" },
        },
        [notionProperties.renewalReminderSentAt]: {
          date: { start: "2026-04-20T00:00:00.000Z" },
        },
        [notionProperties.groupJoinedAt]: {
          date: { start: "2026-04-27T00:00:00.000Z" },
        },
      },
    });

    expect(member).toMatchObject({
      pageId: "page-1",
      telegramUserId: "12345",
      telegramUsername: "@aceon",
      email: "student@example.com",
      status: "trial_active",
      tags: ["翻倉成功"],
      exchangeRegistered: true,
      exchangeName: "MEXC",
      exchangeUid: "UID-1",
      invitationEmailSent: true,
      paymentUidLast4: "1234",
      paymentProofFileId: "photo-file-id",
      paymentProofSubmittedAt: "2026-05-01T00:00:00.000Z",
      finalPnl: "+20%",
      renewalStep: "awaiting_pnl",
      renewalReminderSentAt: "2026-04-20T00:00:00.000Z",
      groupJoinedAt: "2026-04-27T00:00:00.000Z",
    });
  });

  it("falls back to common Tally email property names", () => {
    const member = mapNotionPageToMember({
      id: "page-email",
      properties: {
        [notionProperties.telegramUserId]: {
          rich_text: [{ plain_text: "12345" }],
        },
        [notionProperties.telegramUsername]: {
          rich_text: [{ plain_text: "@aceon" }],
        },
        Email: { email: "fallback@example.com" },
        [notionProperties.status]: { select: { name: "eligible" } },
      },
    });

    expect(member.email).toBe("fallback@example.com");
  });

  it("builds sparse Notion update properties", () => {
    const props = buildNotionProperties({
      status: "payment_pending",
      tags: ["翻倉成功"],
      inviteLink: null,
      email: "student@example.com",
      invitationEmailSent: true,
      renewalStep: "",
      renewalReminderSentAt: null,
      paymentDeadlineAt: "2026-05-01T00:00:00.000Z",
      paymentUidLast4: "1234",
      paymentProofFileId: "photo-file-id",
      paymentProofSubmittedAt: "2026-05-01T00:00:00.000Z",
    });

    expect(props[notionProperties.status]).toEqual({
      select: { name: "payment_pending" },
    });
    expect(props[notionProperties.tags]).toEqual({
      multi_select: [{ name: "翻倉成功" }],
    });
    expect(props[notionProperties.inviteLink]).toEqual({ url: null });
    expect(props[notionProperties.email]).toEqual({
      email: "student@example.com",
    });
    expect(props[notionProperties.invitationEmailSent]).toEqual({
      checkbox: true,
    });
    expect(props[notionProperties.renewalStep]).toEqual({ select: null });
    expect(props[notionProperties.renewalReminderSentAt]).toEqual({
      date: null,
    });
    expect(props[notionProperties.paymentDeadlineAt]).toEqual({
      date: { start: "2026-05-01T00:00:00.000Z" },
    });
    expect(props[notionProperties.paymentUidLast4]).toEqual({
      rich_text: [{ type: "text", text: { content: "1234" } }],
    });
    expect(props[notionProperties.paymentProofFileId]).toEqual({
      rich_text: [{ type: "text", text: { content: "photo-file-id" } }],
    });
    expect(props[notionProperties.paymentProofSubmittedAt]).toEqual({
      date: { start: "2026-05-01T00:00:00.000Z" },
    });
  });

  it("writes telegram username as a title property for this Notion form", () => {
    const props = buildNotionProperties({
      telegramUsername: "@aceon",
    });

    expect(props[notionProperties.telegramUsername]).toEqual({
      title: [{ type: "text", text: { content: "@aceon" } }],
    });
  });

  it("normalizes telegram usernames from common input formats", () => {
    expect(normalizeTelegramUsername("@Aceon")).toBe("aceon");
    expect(normalizeTelegramUsername("https://t.me/Aceon?start=1")).toBe("aceon");
    expect(normalizeTelegramUsername(" t.me/Aceon ")).toBe("aceon");
  });

  it("normalizes exchange UID for uniqueness checks", () => {
    expect(normalizeExchangeUid(" UID-ABC ")).toBe("uid-abc");
  });
});
