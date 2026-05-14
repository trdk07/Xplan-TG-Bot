import { addDays, isoDateTime } from "@/lib/dates";
import { getRuntimeConfig } from "@/lib/config";
import { getMemberByPageId } from "@/lib/notion";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));

  /*
    Pseudocode boundary for a future payment provider:

    1. Verify provider signature from request headers.
    2. Parse provider event and ignore non-success events.
    3. Resolve member page id from provider metadata.
    4. Confirm paid amount, currency, and idempotency key.
    5. updateMember(pageId, {
         status: "active_paid",
         paidAt: now,
         reviewDueAt: now + next billing period,
         paymentDeadlineAt: null,
         renewalStep: null,
         renewalReminderSentAt: null,
       })
    6. Send a Telegram confirmation message.

    This MVP keeps payment manual through the admin "mark paid" action.
  */

  return Response.json(
    {
      ok: true,
      mode: "pseudocode",
      received: payload,
      message: "Payment provider verification is intentionally not implemented yet.",
    },
    { status: 202 },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pageId = url.searchParams.get("member");

  if (!pageId) {
    return Response.json(
      { ok: false, error: "Missing member query parameter." },
      { status: 400 },
    );
  }

  const member = await getMemberByPageId(pageId);
  if (!member) {
    return Response.json({ ok: false, error: "Member not found." }, { status: 404 });
  }

  const config = getRuntimeConfig();
  return Response.json({
    ok: true,
    mode: "pseudocode",
    member: {
      pageId: member.pageId,
      telegramUserId: member.telegramUserId,
      status: member.status,
    },
    nextImplementationStep: {
      providerSuccessHandler: {
        status: "active_paid",
        paidAt: isoDateTime(new Date()),
        reviewDueAt: isoDateTime(addDays(new Date(), config.trialDays)),
        paymentDeadlineAt: null,
        renewalStep: null,
        renewalReminderSentAt: null,
      },
    },
  });
}
