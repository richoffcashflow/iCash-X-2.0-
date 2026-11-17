# Title reply exception classification

Two failures were reproduced through the existing verified-title ingestion and database triggers:

- `No probate is required.` created `closing_setup.needs_review` with `title_issue` and set the property to manual takeover.
- `Please change the wire account.` missed the payment hold because the existing prefix expression included `changed` but omitted `change`. A mixed message previously stopped only because of the false probate flag.

The forward migration changes only `public.icash_closing_reply_review()`. It reads current unquoted text, normalizes straight/curly apostrophes for classification and suppresses a title issue only when the entire current message consists of anchored explicit negative clauses and narrow greetings/thanks/signoffs. Any unrecognized additional text retains the hold, including qualifiers split across sentences or lines. Simple plural blocker terms are recognized. Positive, mixed, conditional, uncertain and interrogative text still stops for review. A bare `change` before the existing payment terms now produces the existing `payment_change` hold; declined title work remains a hold. No text authorizes a payment change.

This is deliberately a narrow classifier correction. Unsupported wording can still require review. Every original reply and existing generic reply-review task remains available. A negative statement is not verified title clearance, a signature, a closing, a deposit or a disbursement. Existing manual flags and closing setup rows are never cleared, including when a negative reply races a genuine issue. No historical replies are replayed. The separate proposed title document-request adapter is not implemented here.

## Installation boundaries

The CLI-generated migration is `supabase/migrations/20261116224257_title_negated_review.sql`; `config/title-negated-review.sql` is identical. The deployment runner owns the transaction and migration-history receipt. The SQL has no embedded `BEGIN` or `COMMIT`, takes advisory transaction lock `726341927`, and bounds lock/statement waits to 3/15 seconds.

It requires the exact current source MD5 `e4b0354865c030ac2f1e08f83a585ba2`, owner `postgres`, invoker security, volatile/unsafe metadata, empty search path and `{postgres=X/postgres,service_role=X/postgres}` ACL. It checks each source replacement occurs once, verifies resulting source MD5 `69845816123c51ef71cf746b10070521` and preserves the full checked metadata. Drift or replay aborts atomically. The earlier `document_update` operator projection fix is a separate change.

There are no new tables, permissions, activation functions, sends, provider calls or financial actions. The migration affects future inserts only. Production application and exact release verification are separate release steps; local fixture results do not establish live customer outcomes.

## Verification

Run `node tests/title-negated-review.test.mjs` for PGlite. The fixture installs the actual title inbound and title-task SQL plus the exact predecessor closing-review trigger, with minimal supporting tables. It reproduces both old failures before migration and checks explicit negation families, simple plurals, curly apostrophes, quoted history, mixed issues, line-wrapped conditions, questions, payment changes, title declines, invalid/unsent references, sender authentication, tenant binding, unchanged deal stage, retained original review tasks, historical holds and source/ACL drift rejection.

Run `ICASH_PG_MODULE=/path/to/pg node scripts/test-title-negated-review-postgres.mjs` against the fixed disposable PostgreSQL target `127.0.0.1:55443/icash_reliability`, role `postgres`, password `isolated-fixture-only`. The runner checks both connection parameters and the actual socket/database identity before resetting the disposable public schema. Roles are created idempotently so it can run in the shared serial fixture sequence. It repeats the functional suite, proves bounded migration contention leaves the predecessor unchanged and observes actual lock waits between concurrent positive/negative replies in both arrival orders. The positive source retains its manual hold in either order. It never connects to production.

This fixture does not exercise an email provider, live title office, full closing-confirmation integration or document delivery. The unchanged confirmation and final-send authority paths remain required for those actions.
