# TG-BOT-bibibi

Telegram membership gate bot backed by a Notion data source. The app is a Next.js + TypeScript MVP with:

- Telegram webhook handling for onboarding, join requests, and group member updates.
- Notion as the only persistent member state.
- Password-protected admin dashboard at `/admin`.
- Daily renewal job endpoint at `/api/jobs/daily`.
- Payment webhook placeholder at `/api/payment/webhook`.

## Environment

Copy `.env.example` to `.env.local` and fill every required value:

```bash
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_GROUP_ID=
NOTION_API_KEY=
NOTION_DATA_SOURCE_ID=
ADMIN_PASSWORD=
APP_BASE_URL=https://your-domain.example
EXCHANGE_NAME=X-Plan
TEACHER_TG_UID=1222518302
TRIAL_DAYS=30
PAYMENT_GRACE_DAYS=3
JOB_SECRET=
PARTNER_API_TOKEN=
MEXC_API_BASE_URL=https://api.mexc.com
MEXC_API_ACCESS_KEY=
MEXC_API_SECRET_KEY=
MEXC_AFFILIATE_ENDPOINT=/api/v3/rebate/affiliate/referral
MEXC_AFFILIATE_UID_PARAM=uid
MEXC_AFFILIATE_MEMBER_INFO=
MEXC_AFFILIATE_LOOKBACK_DAYS=365
MEXC_MIN_DEPOSIT_USDT=100
```

The Telegram bot must be an administrator in the private supergroup with invite and ban permissions. Configure the Telegram webhook with `allowed_updates` including `message`, `callback_query`, `chat_join_request`, and `chat_member`, plus the same secret token as `TELEGRAM_WEBHOOK_SECRET`.

`EXCHANGE_NAME` and the exchange/UID properties are used by the `/start` flow. Matching by Telegram numeric ID or username identifies the Notion member record first. New or not-yet-approved members are then asked to reply with their MEXC UID. If Notion already has an `Exchange UID`, the submitted UID must match it. The Bot then checks the MEXC affiliate API by UID, does not query by `inviteCode`, and only sends an invite link when the UID exists in the affiliate data and the deposit amount is at least 100 USDT. Members with `expired`, `kicked`, or `denied` status are not sent an invite link automatically and must contact the assistant for review.

The default `MEXC_AFFILIATE_ENDPOINT` uses the official UID referral endpoint. If MEXC provides a different affiliate endpoint for the account, override `MEXC_AFFILIATE_ENDPOINT` and `MEXC_AFFILIATE_UID_PARAM` in the deployment environment.

## Notion Data Source

Required properties:

- `Telegram User ID` rich text
- `Telegram Username` rich text
- `email` email
- `已送出邀請` checkbox
- `Status` select
- `Tags` multi-select
- `Exchange Registered` checkbox
- `Exchange Name` rich text
- `Exchange UID` rich text
- `UID Submitted At` date
- `Invite Link` url
- `Invite Expires At` date
- `Group Joined At` date
- `Review Due At` date
- `Payment Deadline At` date
- `Payment UID Last 4` rich text
- `Payment Proof File ID` rich text
- `Payment Proof Submitted At` date
- `Paid At` date
- `Final P/L` rich text
- `Renewal Step` select
- `Renewal Reminder Sent At` date
- `Last Bot Check At` date
- `Last Bot Message` rich text
- `Kick Reason` rich text
- `TradingView` rich text
- `TradingView Access` select

Status options:

`eligible`, `collecting_info`, `invite_sent`, `join_pending`, `trial_active`, `renewal_due`, `payment_pending`, `active_paid`, `partner`, `exempt`, `VIP`, `expired`, `kicked`, `denied`.

`partner`, `exempt`, and `VIP` are non-expiring group access statuses. They can join through the Bot's protected invite flow, are allowed to remain in the group, and are skipped by renewal/payment/deadline jobs.

Run the schema helper after adding new bot fields:

```bash
npm run notion:ensure-schema
```

The Notion view helper organizes the human-facing database tabs without editing
member rows. It defaults to dry-run mode:

```bash
npm run notion:ensure-views
npm run notion:ensure-views -- --apply
```

It keeps the main table intact, tightens the current-member view, and creates
operational views for trial members, payment follow-up, payment review, paid
members, TradingView revocation, historical members, and raw application data.

## Local Development

This project uses Next 16, which requires Node `>=20.19.0`.

```bash
npm run dev
npm run typecheck
npm test
npm run build
```

## Cloudflare Workers Deployment

This app deploys to Cloudflare Workers through OpenNext for Cloudflare.

```bash
npm run cf:build
npm run cf:deploy
```

Set runtime configuration with Wrangler secrets:

```bash
npx wrangler secret bulk .env.local
```

After deployment, point Telegram to the Worker route:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://your-worker.example/api/telegram/webhook",
    "secret_token": "'"$TELEGRAM_WEBHOOK_SECRET"'",
    "allowed_updates": ["message", "callback_query", "chat_join_request", "chat_member"]
  }'
```

The daily renewal endpoint remains available at `/api/jobs/daily`. The deployed Worker includes a scheduled handler that calls that endpoint daily when `triggers.crons` is enabled in `wrangler.jsonc`.

## Partner TradingView API

Set `PARTNER_API_TOKEN` as a Cloudflare Worker secret before enabling partner access. The partner can then call:

```bash
curl -H "Authorization: Bearer $PARTNER_API_TOKEN" \
  "https://your-worker.example/api/partners/tradingview-members"
```

The endpoint returns only unique, non-empty `TradingView` values for members whose `Status` is currently allowed to remain in the Telegram group: `trial_active`, `renewal_due`, `payment_pending`, `active_paid`, `partner`, `exempt`, or `VIP`.

## GitHub Actions Deployment

The repository includes `.github/workflows/deploy-cloudflare.yml`. It runs tests, typechecks, and deploys to Cloudflare Workers whenever `main` is updated. Add these GitHub repository secrets before relying on automatic deployment:

```bash
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
```

Runtime application secrets such as `TELEGRAM_BOT_TOKEN`, `NOTION_API_KEY`, and `ADMIN_PASSWORD` should remain configured in Cloudflare Workers as Wrangler secrets.

## Payment Boundary

Payments are manually reviewed in v1. Members receive exchange internal-transfer instructions, then send a transfer screenshot and UID last four digits to the Bot. The Bot stores the proof metadata on the member record and the admin detail page proxies the Telegram file through an authenticated payment-proof endpoint for screenshot preview. An admin then confirms receipt and uses the dashboard's manual "mark paid" action. A future provider webhook should verify the provider signature, resolve the Notion page from payment metadata, enforce idempotency, then update the member to `active_paid`.

The admin member list includes a `續約狀態` (`Renewal Review`) column for quick triage of the renewal decision flow:

- `即將到期` / `已提醒續約`: active trial members inside the 0–7 day reminder window.
- `待選翻倉`: expired trial member still needs to choose whether the flip goal succeeded.
- `待回覆收益`: member selected a trial result and still needs to reply with the final P/L summary.
- `待選續留`: member needs to choose whether to continue or leave.
- `已申請續費`: member chose to continue and is in the payment flow.
- `不續留` / `逾期未完成`: member declined or missed the renewal/payment deadline.

The admin member list also includes a `付款審核` (`Payment Review`) column for payment-proof triage:

- `待付款資料`: member is in `payment_pending` but has not submitted a screenshot or UID last four digits yet.
- `待補件`: only one of the screenshot or UID last four digits has been submitted.
- `待審核`: both screenshot and UID last four digits are present and ready for manual review.
- `已標記付款`: the member has been marked paid or has a `Paid At` timestamp.

When a screenshot exists, the list and detail pages link to `/api/admin/payment-proof?fileId=...`, which requires admin auth before proxying the Telegram file.

The admin dashboard also links to `/admin/applications` for manual MEXC CSV comparison. Paste the MEXC export into that page to compare CSV UIDs against Notion/Tally `Exchange UID` values, review Notion-only and MEXC-only mismatches, and batch-mark matched applicants as `eligible` for the Bot invite flow.
