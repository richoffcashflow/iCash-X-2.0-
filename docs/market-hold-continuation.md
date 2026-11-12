# Independent research after a held market

## Failure and scope

Required targeting/financial queries must not overlap unresolved paid discovery. The canonical query context already blocks only the ZIPs bound to the original operation, or every ZIP if its scope is unknown. However, inventory preparation returned `inventory_held` before its ordinary market-rotation path. A fresh funded unrestricted account could therefore wait indefinitely behind another account's unknown search despite having eligible disjoint inventory.

This change only handles such bystanders. Accounts with any own unfinished discovery remain held for their separate, source-bound reconciliation/continuation. It does not resolve those operations or establish customer recovery. Missing setup is unrestricted under the existing canonical scope function; an explicitly local setup stays held. Ordinary successful-search diversity is a separate change.

## Prospective behavior

The service-only helper requires enabled budget/account/configuration, valid membership/data rights/rate, positive unreserved wallet balance, no own unfinished discovery, supported v2/no legacy list, and the existing current financial capability and synchronized exact exclusion list. It shares the normal budget/account/configuration locks and locks setup/settings rows. The canonical operation-to-ZIP evidence expression is materialized once, including every conflicting exact source ZIP. Any unbound operation holds globally.

Only a different, existing, eligible, due, canonically authorized and known ZIP outside every unresolved scope can be selected. Account-specific stalled ZIPs remain excluded. At most 64 candidates receive the existing least-loaded/opportunity scoring. No candidate or missing metadata leaves the old configuration unchanged; it is not declared empty/exhausted. The selection changes only future configuration identity/page/schedule and the destination's existing scan cooldown. Private audit preserves complete old/new configurations and the blocking source keys/scopes.

The discovery service exits on `inventory_market_changed` before requesting an estimate or paid work. Any later work must pass the unchanged final current-scope, financial-policy, exact free-estimate, spend, provider, duplicate and recipient controls. A stale worker cannot purchase its former revision. The patch does not mutate operations, requests, claims, original pages, contacts, wallets or receipts. Changing a ZIP is not completed usage, outreach or a seller result.

## Release gates

- Install `config/market-hold-continuation.sql` and its byte-identical CLI-created migration only with the caller-owned transaction, including migration receipt. The body contains no top-level transaction control.
- Verify exact current predecessors before application; the guarded prepare/context/scope/capability hashes must all match. Do not weaken a guard after concurrent drift.
- The private setting installs **disabled**. No activation is implied by installation or a PR.
- Require independent final review, exact-head canonical Reliability (including native PostgreSQL contention), aggregate tests, build and release verification. Local PGlite is functional evidence, not proof of concurrent PostgreSQL behavior. The fixture retains real context and final policy/claim bodies, with synthetic low-level accounting boundaries and no provider requests.
- Read back installed definitions, ACLs/RLS and the disabled setting. Confirm source canonical scope and final financial functions remain unchanged. Then activate only the reviewed private setting with the exact release SHA and activation time, under normal automatic-release authorization/gates. No application behavior change is required to understand the existing return status; ordinary application release verification still applies.
- When composing with successful-search diversity, install this migration first. The later migration must explicitly guard the resulting prepare definition and preserve this hold branch. Keep each setting independently controllable.
- Observe bounded private audit and actual subsequent estimates/discovery/settled work. Report remaining own-unknown/local/unscoped/metadata-blocked accounts separately; do not equate configuration rotation with recovery.

Rollback is disabling only `market_hold_continuation_settings.enabled` under the shared budget lock. Preserve audit, the current configuration, original reservations and late-receipt paths. Never roll a configuration back into a now-held scope or replay an earlier operation to test rollback.

## Validation coverage

`market-hold-continuation.test.mjs` reproduces the old deadlock, verifies disabled installation, disjoint source-bound selection, immutable original operations and configuration audit, no duplicate rotation, exact stale-revision rejection, fresh estimate requirement, missing/local authorization boundaries, malformed/multiple/wrong-account scope evidence, missing/unsynchronized metadata, all original account gates, load fairness, 10,000-candidate inventory and private access.

`market-hold-continuation-service.test.mjs` runs the real discovery service with synthetic transports and proves both held and changed inventory return before provider work.

`test-market-hold-continuation-postgres.py` uses only the fixed disposable localhost test database and tests competing Pause/setup/settings/unknown-operation changes, 12 concurrent same-scope calls, unchanged financial holds, stale workers, a newly held selected ZIP and transaction rollback on predecessor drift. It is registered in canonical Reliability. Never point it at production.
