# Seller intake text activity

The Bot activity report omitted receipt-backed outgoing seller intake texts while their property screening was still `awaiting_address`. Both the customer workspace and the owner's customer view use the same report. The read-only correction counts an intake text only when its original accepted/delivered message has a provider ID and exact same-account message, thread, deal, screening, Meta lead and Meta message-source bindings.

Completed real-property text eligibility, local calendar windows and original dispatch timestamps remain unchanged. Queued/unknown/failed sends, practice properties and archived or unrelated intake records remain excluded. Address completion cannot count a message twice. Leads, calls, contracts, funds, contact authority, original receipts and the existing interface are unchanged.

## Install

Apply `supabase/migrations/20261117064608_intake_text_activity_visibility.sql` once through the migration runner, with the patch and migration-history entry in one transaction. `config/intake-text-activity-visibility.sql` is an identical review copy, not a second installation. The runner owns `BEGIN`/`COMMIT`; neither file opens or commits an outer transaction.

The patch requires `public.icash_activity_report(uuid,integer,text)` to have definition MD5 `869238dd65e4d8af148e32757577db69`, stable volatility, security invoker, empty search path and ACL `{postgres=X/postgres,service_role=X/postgres}`. Its verified result hash is `e8cfee55b5710ea4cd0e78eb9e981ada`, with the same owner and privileges. Any unexpected source or permission drift aborts installation.

This is a backward-compatible reporting RPC correction, immediately used by the existing frontend after installation. It requires no web/worker feature activation, data backfill, message replay or provider requests. Verify the result definition/metadata and the same-period receipt totals after installation; do not interpret a corrected count as new outreach or delivery.

## Verification

`node --experimental-strip-types tests/intake-text-activity-visibility.test.mjs` runs the actual SQL in isolated Postgres. It verifies source/ACL rejection, account and original-source binding, all reporting periods, local-midnight boundaries, original dispatch clocks, unknown/unsent/practice exclusions, no duplicate after address completion, unchanged other metrics and no message/thread/spend writes.

Existing activity-report, reporting-period, seller-default-thread, seller-reply, text-composer and property-call-history suites cover the shared read paths. Production review should compare aggregate receipts independently across all accounts; customer identities and message bodies belong only in private evidence.
