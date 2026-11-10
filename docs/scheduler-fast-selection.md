# Faster scheduler selection

After the routing-index repair, a live profile still spent about 1.57 seconds in SMS contact projection and 0.54 seconds in repeated contact preparation. Of 461 unprojected candidates, 455 failed the existing quality policy. Full receipt validation and sender selection were repeated before discovering that rejection.

The service-only, read-only quality hint rejects only source-bound non-mobile phones and immutable different-phone choices without an original human-reply exception. Missing or malformed evidence and unchosen owners continue to the original validator. The hint never writes a choice, reads provider data, admits a send, clears a hold or changes phone selection. It runs in a materialized candidate stage only where the original national-observation selector already requires the full quality validator. Legacy candidates retain their original path.

Preparation also skips national receipt bindings with both exact voice and SMS channels already present. Missing channels, different accounts, source hashes, phones or receipts retain the full original checks. The final order and limit, insertion loops, source/recipient locks, customer controls, financial checks, quality validator and privileges of all existing functions remain unchanged.

The migration verifies the exact deployed definitions before changing either selector, and fails atomically on drift. The helper has an empty search path, STABLE volatility and service-only execution. No new schema/table permissions are granted.

Offline coverage compares real original quality decisions against the hint, verifies human/account/unknown boundaries and read-only behavior, and reduces counted full checks from 160 to one with identical selected rows. Preparation tests cover cold/warm, each missing channel, revoked and mismatched historical sources, account scope, generic plans, exact unchanged loop bodies and atomic drift rejection. The existing native PostgreSQL preparation suite exercises competing queues, late Pause and receipt revocation with the new preparation definition.

Apply only the matching migration after the exact-head Reliability run passes, then verify live function readback, a rolled-back scheduler profile and ordinary production completions. Do not count an empty contact result, held job or queued ticket as delivered outreach. The original definitions in `tests/fixtures/scheduler-fast-selection-before.json` provide a rollback without changing data or replaying provider work.
