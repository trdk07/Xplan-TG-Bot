# Discord Admin Controls Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation with a final independent review.

**Goal:** Add authenticated dashboard unlink and immediate role synchronization without deployment.
**Architecture:** Signed internal POST to existing Discord Worker, serialized through its guild Durable Object; durable unlink intents survive uncertain Notion writes. Dashboard invokes the Bot and only writes audit fields.
**Tech Stack:** Next.js, TypeScript, Cloudflare Worker/DO, Notion, Vitest.
**Spec:** docs/superpowers/specs/2026-10-29-discord-admin-controls-design.md

## Global Constraints

- No production mutations/deployments; synthetic external services only.
- Preserve paid/volume/TG facts and unrelated roles; no kicks.
- Independent shared secret, HTTPS, bounded body, strict request/response DTO, five-minute signature lifetime.
- Reuse isolated worktree, branch codex/admin-discord-controls from main f8befec.

## Review Focus

- Unauthenticated, replayed or body-modified calls cannot affect a member.
- Stale dashboard or duplicate Notion binding cannot affect a replacement binding.
- Failed/unknown role or Notion operations cannot falsely clear proof or restore access.
- Pending unlink blocks normal verification/cron regrant and resumes after restart.
- UI displays configuration/pending/error outcomes accurately, never internal proof.

### Task 1: Bot operation boundary and recovery

**Files:** shared/discord-admin-protocol.ts, apps/discord-bot/src/{http,index,engine,store,notion,types}.ts, apps/discord-bot/tests/admin.test.ts.
**Interfaces:** AdminRequest {action,requestId,pageId,discordId,verifiedAt,operator}; AdminResult {action,message}. Engine.admin(request) is serialized and replay-safe; Services.clearBinding validates and clears only five verification/result properties.
- [x] Write failing signed HTTP, stale/duplicate binding, unlink ordering, unknown write/recovery/replay and synchronization tests; run RED.
- [x] Implement signed dispatch, engine operation and durable pending unlink recovery; run GREEN and full Discord tests/typecheck/runtime.

### Task 2: Dashboard integration

**Files:** lib/discord-admin.ts, app/admin/actions.ts, app/admin/components/DiscordAdminControls.tsx, app/admin/member/[pageId]/page.tsx, __tests__/discord-admin-controls.test.ts.
**Interfaces:** server-only request client signs fixed endpoint; admin actions enforce auth, expected binding and confirmation, lease + audit, return typed UI result.
- [x] Write failing auth/config/stale/confirmation/timeout/data-preservation and rendered UI tests; run RED.
- [x] Implement client/actions/forms with pending state and fresh results; run GREEN, complete root tests/typecheck/Cloudflare build, responsive synthetic preview.

### Task 3: Review and delivery

**Files:** .env.example, apps/discord-bot/.dev.vars.example, docs/discord-admin-controls.md.
- [x] Document owner-only shared-secret setup, behavior and failure recovery without applying it.
- [x] Independent final code review, fix concrete findings with regressions; run final suites/build.
- [x] Prepare verified feature-branch delivery and follow-up PR; do not merge/deploy.
