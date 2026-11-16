# Journey message preflight continuation

The journey selector previously counted a selection as a delivery attempt. After three selections, a fourth poll moved the journey message to `needs_review`, even when configuration checks, sender verification or final admission had prevented every provider attempt. Restoring configuration could then leave the original ready text permanently blocked by the journey's review state. This was reproduced with local fixtures, not established as a historical customer incident.

Migration `20261116224226_journey_message_preflight_retry.sql` removes that selection-count cutoff. It retains the original message ID, body, monotonic attempt counter, 30-minute selection lease, journey expiry, existing current-source checks and all final dispatch delegates. Only an original text bound to the same account and thread, still `ready` with no provider ID, can be selected again. Missing or misbound originals enter the existing review branch. Accepted/delivered originals are recognized as sent; dispatching, unknown, failed, cancelled or reviewed originals are never replayed. No existing review state, provider receipt, financial operation, accepted terms or workflow history is reset.

The change affects ordinary journey messages such as buyer intake links, deposit instructions and viewing coordination. It creates no buyer call adapter, booking, contract signature or cleared-funds evidence. Current hours, STOP, Pause, manual control, financial admission, tenant binding, purchase status and current viewing/deposit state retain their existing authority. Normal quiet-hours holds occur before the selection counter increments and were not the reproduced failure.

The forward patch pins `icash_claim_journey_message()` to predecessor definition MD5 `a7dddbab7991f436420991832688f09a` (the body-only MD5 is `d1250610e473cc2b4399c18b866ce176`), postgres ownership and the exact postgres/service-role ACL. It changes only the cutoff and original-message binding/null guard. The resulting definition must hash to `20ccd9d013a36491533cb033e218067c`; function OID, owner and ACL must remain identical. Unexpected source, privilege drift or repeat application fails closed. Config and migration files are byte-identical and contain no transaction boundary: the migration runner owns the transaction for both replacement and ledger. The patch takes shared advisory transaction lock `726341927` before reading its predecessor and retains 3-second lock/15-second statement bounds. The CLI generated the migration name. Release ownership remains with the coordinated release process; verify the resulting function and exactly one ledger row after commit. This branch performs no production installation or reset.

Validation commands, with normal repository dependencies installed:

```sh
node tests/journey-message-preflight-database.test.mjs
node tests/journey-message-preflight-service.test.mjs
```

The first executes the actual journey selector, allowed/current-source helpers and final journey wrapper, proves the predecessor failure, applies the real forward migration and exercises recovery, receipt exclusions, original binding, backoff, source invalidation, financial/source holds, ACL drift and history preservation. It explicitly fixtures the unchanged downstream transport admission boundary. The second executes the actual journey and dispatch services against those SQL functions: configuration, number-verification and final-admission holds recover after four passes; lost claim responses and unknown provider outcomes never replay. Provider functions are local fixtures, and network access is disabled.

Native contention runs against a disposable PostgreSQL 17 instance on loopback, using an installed local `pg` driver:

```sh
JOURNEY_NATIVE_TEST=1 JOURNEY_NATIVE_PORT=55443 \
  ICASH_PG_MODULE=/path/to/isolated/node_modules/pg \
  node tests/journey-message-preflight-native.mjs
```

The native runner only accepts loopback with a nonstandard port and the fixed fixture user/password. It creates and drops its own randomly named `journey_retry_*` database, leaving other fixture schemas alone. It proves that ledger failure rolls back the replacement and simultaneous patch runners serialize before the source check, then exercises simultaneous selectors, one-use dispatch, receipt arrival on both sides of dispatch and STOP contention. It uses the repository's original base dispatch function for its unchanged budget/advisory/message-row locking primitive; it does not claim to reconstruct every later policy wrapper. Existing receipt, sender-routing, inventory-admission, deferred-text and current-hours suites cover those unchanged surrounding boundaries.

Both new `.test.mjs` suites are discovered by `scripts/test-all.mjs`. The release coordinator should add `journey-message-preflight-database` and `journey-message-preflight-service` to the existing local release suite list, and add the native command after the isolated `pg` driver is installed in the existing database-contention CI job. No new job or timeout increase is needed. Shared CI and release-list files are intentionally left to that coordinator.
