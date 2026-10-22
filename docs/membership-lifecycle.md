# Membership lifecycle and Telegram funnel

## Approved behavior

Telegram is a community funnel. Expiration, late payment, membership observations and admin membership disable actions do not ban or kick a Telegram participant. Initial invitation identity/link checks remain in place. Existing Discord code is not merged or called by this change; it continues to consume Notion membership status and dates. The admin displays the Discord bot's recorded fields only.

Canonical Status options (12): `collecting_info`, `eligible`, `join_pending`, `trial_active`, `payment_pending`, `active_paid`, `partner`, `exempt`, `VIP`, `expired`, `kicked`, `denied`. `kicked` is retained for backwards compatibility with other consumers, but the admin label/action now means disabled membership, not a Telegram ban. VIP is preserved because its business distinction has not been removed.

- `invite_sent` becomes `join_pending`.
- `sent_7day_survey` and `sent_3day_offer` become reminder records, not membership states.
- `renewal_due` is retired; a due membership becomes `expired` on the next daily run.
- `user_refused` becomes `Renewal Step=declined` without shortening the current term.
- Questionnaire and final-P/L collection are removed. Historical P/L data is not deleted.
- Payment remains manual. `Renewal Step=payment_pending` identifies the current request even after membership expires; historical Paid At does not imply that a new invoice was reviewed. Proof completion never automatically grants membership. Complete submitted proof remains in the review queue across payment and membership deadlines, including repeated restore-subscription requests.

## Reminder contract

`Review Due At` remains the membership deadline. The daily job uses the existing UTC 01:00 schedule (Taipei 09:00). It sends one notice in days 4–7 and a second in days 1–3; a missed earlier window does not cause two notices at once. Expired memberships receive no pre-expiry notice. Both notices state the deadline and that Telegram access remains available.

Date fields:

- `Renewal Reminder Sent At`: existing 7-day notice timestamp.
- `Renewal Reminder 3 Day Sent At`: 3-day notice timestamp.
- `Renewal Reminder Due At`: deadline of the term those timestamps belong to.

The stored deadline prevents reminders for a previous term from suppressing a renewed term. Payment confirmation and trial extensions reset all three fields. A send failure leaves its marker unset for retry. Missing date properties block reminder sends and produce a job error; they must never silently drop the marker and allow repeated sends. As with any external send plus database write, a successful Telegram send followed by a failed Notion write may require operator inspection before retry; the two systems do not provide a shared transaction.

## Legacy compatibility and migration

Old values are still readable but are excluded from status selectors and new writes. Daily processing normalizes only evidence-supported records. Past-due legacy records become expired; an invite record becomes join_pending. A future trial requires an actual join date and no payment history. A paid term requires dated payment and subscription duration covering the current deadline. Missing, inconsistent, or historical-only payment evidence is surfaced for manual review instead of guessing a paid tier. Those members still receive generic reminders and retain generic access during their recorded valid term; tier uncertainty does not revoke it. Blank/unknown Status values deny entry rather than defaulting to eligible.

An old 7-day/3-day reminder is carried forward as already sent for its term. Original Notion options must remain until affected records and all consumers are migrated. Do not bulk-map all old reminder statuses to trial or paid.

## Release preparation

1. With the existing service credentials, run `npm run notion:ensure-schema` (dry run), review, then `npm run notion:ensure-schema -- --apply`. It adds missing fields/options; it does not delete old options or rewrite member rows.
2. Confirm the three reminder fields are dates. The new fields can safely be added before deploying the code.
3. Run tests, typecheck and `npm run cf:build`. Push the feature branch for owner review. This task does not directly deploy Cloudflare or merge main.
4. After deployment, inspect legacy records marked for review and assign the correct canonical status with supporting membership/payment evidence. Keep Discord Status mapping compatible until its planned project integration is completed.
5. Only after all affected records and consumers have been checked, remove unused old select options from Notion.

Current implementation validation uses synthetic members; no live Telegram messages or Discord role changes are sent by tests. The available Notion connector returned 404 for the target database/data source during this task, so live schema preparation was not performed.
