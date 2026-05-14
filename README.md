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
```

The Telegram bot must be an administrator in the private supergroup with invite and ban permissions. Configure the Telegram webhook with `allowed_updates` including `message`, `callback_query`, `chat_join_request`, and `chat_member`, plus the same secret token as `TELEGRAM_WEBHOOK_SECRET`.

`EXCHANGE_NAME` and the exchange/UID properties are kept for historical admin data. The current `/start` flow does not ask users for exchange registration or UID; matching by Telegram numeric ID or username is enough to issue a protected invite link.

## Notion Data Source

Required properties:

- `Telegram User ID` rich text
- `Telegram Username` rich text
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
- `Paid At` date
- `Final P/L` rich text
- `Renewal Step` select
- `Renewal Reminder Sent At` date
- `Last Bot Check At` date
- `Last Bot Message` rich text
- `Kick Reason` rich text

Status options:

`eligible`, `collecting_info`, `invite_sent`, `join_pending`, `trial_active`, `renewal_due`, `payment_pending`, `active_paid`, `partner`, `exempt`, `VIP`, `expired`, `kicked`, `denied`.

`partner`, `exempt`, and `VIP` are non-expiring group access statuses. They can join through the Bot's protected invite flow, are allowed to remain in the group, and are skipped by renewal/payment/deadline jobs.

Run the schema helper after adding new bot fields:

```bash
npm run notion:ensure-schema
```

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

## GitHub Actions Deployment

The repository includes `.github/workflows/deploy-cloudflare.yml`. It runs tests, typechecks, and deploys to Cloudflare Workers whenever `main` is updated. Add these GitHub repository secrets before relying on automatic deployment:

```bash
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
```

Runtime application secrets such as `TELEGRAM_BOT_TOKEN`, `NOTION_API_KEY`, and `ADMIN_PASSWORD` should remain configured in Cloudflare Workers as Wrangler secrets.

## Payment Boundary

Payments are manually reviewed in v1. Members receive exchange internal-transfer instructions, then an admin confirms receipt and uses the dashboard's manual "mark paid" action. A future provider webhook should verify the provider signature, resolve the Notion page from payment metadata, enforce idempotency, then update the member to `active_paid`.
