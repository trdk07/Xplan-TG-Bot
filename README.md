# Xplan Telegram / Admin and Discord Bots

Two independently built Cloudflare Workers share the same Notion membership data source. The root application is the Next.js + TypeScript Telegram bot and admin dashboard, with:

- Telegram webhook handling for onboarding, join requests, and group member updates.
- Notion as the only persistent member state.
- Password-protected admin dashboard at `/admin`.
- Daily renewal job endpoint at `/api/jobs/daily`.
- Payment webhook placeholder at `/api/payment/webhook`.

| Location | Application | Cloudflare Worker |
| --- | --- | --- |
| Repository root | Telegram bot and `/admin` dashboard | `tg-bot-bibibi` |
| [`apps/discord-bot`](apps/discord-bot) | Discord verification and membership roles | `xplan-discord-verification` |

Each application keeps its own `package.json`, `package-lock.json`, Wrangler configuration and secrets. Importing Discord into this repository preserves its existing behavior; it does not deploy it or align its membership rules with the newer TG rules. See [Discord integration and current policy differences](docs/discord-integration.md).

## Environment

For the TG/admin application, copy `.env.example` to `.env.local` and fill every required value. Discord uses its own local configuration described in the [integration guide](docs/discord-integration.md#configuration-and-secrets).

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
- `Renewal Reminder Sent At` date (7-day reminder)
- `Renewal Reminder 3 Day Sent At` date
- `Renewal Reminder Due At` date (membership period key)
- `Last Bot Check At` date
- `Last Bot Message` rich text
- `Kick Reason` rich text
- `TradingView` rich text
- `TradingView Access` select

Status options:

`eligible`, `collecting_info`, `join_pending`, `trial_active`, `payment_pending`, `active_paid`, `partner`, `exempt`, `VIP`, `expired`, `kicked`, `denied`.

Legacy values are read for migration only. See [membership lifecycle and release preparation](docs/membership-lifecycle.md).

`partner`, `exempt`, and `VIP` are non-expiring membership statuses. Telegram is a community funnel: existing participants are not removed for expired or disabled membership. Membership expiration is recorded in Notion for other services to consume.

Prepare Notion fields before releasing the new reminder job (the helper defaults to dry-run and preserves existing options):

```bash
npm run notion:ensure-schema
npm run notion:ensure-schema -- --apply
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

The TG/admin app requires Node `>=20.19.0`; use Node `>=22.18.0` when working on both applications. Install both dependency trees from the repository root:

```bash
npm ci
npm run discord:install
```

Existing root commands continue to target TG/admin:

```bash
npm run dev
npm run typecheck
npm test
npm run build
```

Discord and combined checks are available from the root:

| Command | Purpose |
| --- | --- |
| `npm run discord:dev` | Run the Discord Worker locally |
| `npm run discord:test` | Run Discord unit tests |
| `npm run discord:typecheck` | Typecheck Discord |
| `npm run discord:build` | Build Discord with a Wrangler dry run; no deployment |
| `npm run discord:test:runtime` | Build and test the Discord Worker with simulated Notion/Discord APIs |
| `npm run test:all` | Run TG/admin and Discord unit tests |
| `npm run typecheck:all` | Typecheck both applications |

The Discord runtime check is separate from `test:all`. See the [integration guide](docs/discord-integration.md) for configuration and deployment boundaries.

## Discord records in the admin dashboard

The member list (compact and full) and detail page display Discord verification
and the role recorded in Notion. The detail page also shows the Discord ID and
verification time in the dashboard's existing Asia/Taipei date format.

The dashboard reads `Discord_id` (rich text), `Discord Verified At` (date), and
`Discord Role` (select). An ID with a valid verification date displays `已驗證`;
both absent displays `無驗證紀錄`; partial or invalid records display
`驗證資料不完整`. The role is displayed independently, exactly as recorded;
an empty role displays `尚無身分組紀錄`.

The Discord bot owns these fields. The dashboard does not write them, infer a
role from membership status, or query Discord. Refresh the page to read updated
Notion records. This display feature needs no additional dashboard credentials
or schema migration. Credential hashes and tier proofs are not included in the
admin member model. The Discord Worker has its own credentials.

For browser review with synthetic data, run
`DISCORD_VISUAL_OUTPUT=output/playwright npm test -- __tests__/discord-admin.test.ts`
and serve that directory locally. Generated HTML uses the actual admin page
components and stylesheet; it is for visual inspection, not operating the bot.

## Cloudflare Workers Deployment

The root TG/admin app deploys to Worker `tg-bot-bibibi` through OpenNext for Cloudflare. These commands do not build or deploy the Discord Worker:

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

The endpoint returns only unique, non-empty `TradingView` values for members whose `Status` grants current membership: `trial_active`, `payment_pending`, `active_paid`, `partner`, `exempt`, or `VIP`. Telegram presence itself is not evidence of an active membership.

## GitHub Actions Deployment

The repository includes `.github/workflows/deploy-cloudflare.yml`. It runs the TG/admin tests and typecheck, then deploys `tg-bot-bibibi` whenever `main` is updated. Discord checks run separately; there is no automatic Discord deployment in this integration. Add these GitHub repository secrets before relying on the TG/admin automatic deployment:

```bash
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
```

Runtime application secrets such as `TELEGRAM_BOT_TOKEN`, `NOTION_API_KEY`, and `ADMIN_PASSWORD` should remain configured in Cloudflare Workers as Wrangler secrets.

## Payment Boundary

Payments are manually reviewed in v1. Members receive exchange internal-transfer instructions, then send a transfer screenshot and UID last four digits to the Bot. The Bot stores the proof metadata on the member record and the admin detail page proxies the Telegram file through an authenticated payment-proof endpoint for screenshot preview. An admin then confirms receipt and uses the dashboard's manual "mark paid" action. A future provider webhook should verify the provider signature, resolve the Notion page from payment metadata, enforce idempotency, then update the member to `active_paid`.

The admin shows membership state separately from 7-day and 3-day reminder records. Reminders do not overwrite trial/paid status; expiration updates Notion without removing Telegram participants. Questionnaire and P/L collection are no longer part of renewal. Historical membership states remain visible for evidence-based review.

Payment review uses the current payment request, not historical `Paid At`. It can show pending proof/review even while membership is expired; confirming payment activates membership, extends the deadline and resets reminder markers without generating an unnecessary rejoin invitation.

When a screenshot exists, the list and detail pages link to `/api/admin/payment-proof?fileId=...`, which requires admin auth before proxying the Telegram file.

The admin dashboard also links to `/admin/applications` for manual MEXC CSV comparison. Paste the MEXC export into that page to compare CSV UIDs against Notion/Tally `Exchange UID` values, review Notion-only and MEXC-only mismatches, and batch-mark matched applicants as `eligible` for the Bot invite flow.
