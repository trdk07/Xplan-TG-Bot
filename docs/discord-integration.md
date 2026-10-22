# Discord integration

The existing Discord verification application is maintained in `apps/discord-bot` alongside the TG bot and admin dashboard. This is a repository integration: Discord verification, role assignment, Notion writeback and scheduled synchronization retain their existing behavior. Membership-policy changes require a separate functional change.

## Repository and runtime boundaries

| Concern | TG / admin | Discord |
| --- | --- | --- |
| Application directory | Repository root | `apps/discord-bot` |
| Worker name | `tg-bot-bibibi` | `xplan-discord-verification` |
| Package and lockfile | Root `package.json` / `package-lock.json` | Own `package.json` / `package-lock.json` |
| Wrangler configuration | Root `wrangler.jsonc` | Own `wrangler.jsonc` |
| Local secrets | Root `.env.local` | `apps/discord-bot/.dev.vars` |
| Build | Next.js / OpenNext | Wrangler Worker bundle |
| Deployment from `main` or manual dispatch | TG/admin job in `deploy-cloudflare.yml` | Independent Discord job in the same workflow |

These are independent npm projects. Root forwarding commands run the Discord project's own tools; they do not merge dependencies or deploy both Workers. Root TypeScript checks exclude `apps/discord-bot`, and each app checks its own source.

The imported Discord source, tests and scripts are unchanged. Its lockfile adds four missing optional Sharp platform entries so clean installs also pass npm 11 in Linux CI; every existing locked package version and integrity remains unchanged.

Both applications consume the shared Notion membership record. TG owns its membership and payment workflows. Discord owns verification and managed Discord roles, and writes `Discord_id`, `Discord Verified At`, `Discord Credential Hash`, `Discord Tier Proof` and `Discord Role`. The admin reads only the public verification/role fields; it neither derives a Discord role from Status nor exposes credential hashes or tier proofs. `Discord Role` records the last successful role synchronization result; it is not an input granting permission.

Discord retains its ten-minute scheduled synchronization, `MEMBER_GATE` binding and KV-backed `NotionMemberGate` Durable Object. The deployment job uses the existing Worker identity, binding and migration history.

## Development and checks

Use Node `>=22.18.0`. Run these commands from the repository root:

```bash
npm ci
npm run discord:install
npm run discord:test
npm run discord:typecheck
npm run discord:build
npm run discord:test:runtime
```

- `npm run discord:dev` starts the Discord Worker locally after local configuration is supplied.
- `npm run test:all` runs both applications' unit tests.
- `npm run typecheck:all` checks both applications independently.
- `discord:build` runs `wrangler deploy --dry-run`; it creates a local bundle without publishing it.
- `discord:test:runtime` builds and exercises the Worker and Durable Object with synthetic credentials and intercepted Notion/Discord APIs. It does not send real verification messages or change live roles or member records. It is separate from `test:all`.

## Configuration and secrets

Only source, lockfiles, configuration templates and documentation are imported. Real `.dev.vars` / `.env` files, local credential state, `node_modules`, `.wrangler` and build output are not copied from the former project.

For local Discord development, copy [`apps/discord-bot/.dev.vars.example`](../apps/discord-bot/.dev.vars.example) to `apps/discord-bot/.dev.vars` and supply the existing Discord application's settings. Its secrets include `DISCORD_BOT_TOKEN`, `NOTION_API_KEY` and a stable `AUTH_SECRET` of at least 32 characters. Keep the existing production `AUTH_SECRET`: changing it invalidates existing verification credentials/proofs. Each Worker receives its own secrets even when both use the same Notion integration.

Local secrets do not automatically become Cloudflare secrets. Root `.env.local` is not the Discord configuration. Unlike the isolated runtime test, `discord:dev` can call real Notion and Discord services when supplied real credentials.

Deployments preserve runtime secrets already configured on the existing Discord Worker; the workflow does not bulk-upload local secrets, rotate `AUTH_SECRET`, register commands, publish a verification panel, or modify Notion schema.

## Automatic deployment

[`.github/workflows/deploy-cloudflare.yml`](../.github/workflows/deploy-cloudflare.yml) deploys both applications when `main` receives a push or an operator starts `workflow_dispatch`. Each Worker has an independent job with its own dependency install, tests, typecheck and build. Discord also runs its simulated Worker runtime test before deploying. A failure in one job does not prevent the other job from succeeding; the two deployments are not an atomic release. Pull-request checks and feature-branch pushes do not automatically deploy either Worker.

The TG job uses the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. The Discord job uses `DISCORD_CLOUDFLARE_API_TOKEN` when present, otherwise falls back to `CLOUDFLARE_API_TOKEN`. Its target Worker name and `account_id` come from the unchanged [`apps/discord-bot/wrangler.jsonc`](../apps/discord-bot/wrangler.jsonc); the TG account secret is not passed to the Discord job.

The selected Discord token must have deployment permission for the account configured in that file. Checking that a GitHub secret exists does not verify its account access or permissions. If the existing shared token lacks that access, the repository owner must add an appropriately authorized `DISCORD_CLOUDFLARE_API_TOKEN`. Discord bot/Notion credentials remain Cloudflare runtime secrets on the existing Worker and are not copied from the TG Worker.

Adding or editing the workflow on a feature branch does not execute a deployment. A successful local build or runtime test also does not establish that a production deployment has occurred.

## Preserved Discord membership policy

The imported [`membership.ts`](../apps/discord-bot/src/membership.ts) intentionally retains its earlier policy. Status comparisons are trimmed and case-insensitive. A supplied invalid deadline requires review; a deadline at or before the current time denies a membership role, except for the permanent statuses below.

| Notion state | Existing Discord result |
| --- | --- |
| `partner` | 飛行員; no renewal deadline |
| `exempt`, `VIP` | 宇航員; no renewal deadline |
| `trial_active` | 探索者 |
| `active_paid`, `eligible` | 宇航員 |
| `join_pending` with a future valid deadline and any valid `Paid At` at or before now | 宇航員; this checks historical payment presence, not coverage of the current term |
| `collecting_info`, other nonempty statuses not blocked below, and unresolved `join_pending` | With the default `INCOMPLETE_MEMBER_POLICY=trial`, 探索者 unless an explicit override or matching prior binding supplies the tier |
| Blank Status, archived record, `expired` / `expire`, `kicked` / `kick`, `denied` / `deny` | No membership role |

Missing `Review Due At` is allowed by the default `trial` policy: explicit trial/paid statuses keep their mapped tier, and otherwise unresolved records fall back to trial. This does not create or extend a Notion deadline. Setting `INCOMPLETE_MEMBER_POLICY=review` instead requires review for missing dates or ambiguous tiers. Overrides and previous bindings only resolve a tier for an existing valid future term; they do not bypass blocked or expired membership.

These rules differ from the newer TG lifecycle: `eligible` is an onboarding qualification in TG, `collecting_info` and unknown values do not automatically grant TG membership, and TG's legacy paid-tier inference requires evidence covering the current term. The Discord `join_pending` historical-payment rule and missing-date fallback remain unchanged in this integration. Do not assume that one shared Notion Status means identical authorization in both applications, or remove legacy options before checking both consumers. Aligning these rules is deferred to the next functional instruction.

Discord matches Exchange UID and email against one existing Notion record, persists verification before granting a role, and writes the resulting role label after the Discord operation succeeds. Expired/blocked members lose only the Bot-managed membership roles; unrelated roles and free Discord access remain. TG expiration likewise does not remove existing Telegram participants, but its implementation and timing remain independent.

## Imported documentation

The application was imported from `xplan-dc-verivication-bot`. Its [`README.md`](../apps/discord-bot/README.md), [`DEPLOYMENT.md`](../apps/discord-bot/DEPLOYMENT.md) and [`TG-BOT-RESEARCH.md`](../apps/discord-bot/TG-BOT-RESEARCH.md) include dated research, setup and deployment snapshots. Treat those historical observations as context, not evidence of a fresh deployment, current credentials, current Notion schema, or policy parity with today's TG implementation. This guide describes the repository integration boundary; the imported implementation and tests define preserved Discord behavior.
