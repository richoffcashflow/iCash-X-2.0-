# Expired owner-preflight cleanup handoff

An expired known free list returned `held` before the handler could reach its existing targeted cleanup. Renewal correctly required confirmed deletion, so current funded work waited behind the global FIFO cleanup backlog. The ordinary selector can still reach original primaries with no ticket or an eligible `owner_preview_rate_limited` ticket. Generic held orphan tickets remain unchanged; independent eligible work remains selectable.

This change adds a read-only `cleanup_required` result for the latest exact account/fingerprint/items/request, with original known-list proof and current unstarted source checks. One atomically admitted DELETE uses the existing shared request limiter and original cleanup recorder. One ordinary claim reread may then create a fresh immutable generation. A false recorder result, unknown response, lost admission acknowledgment, or busy lease cannot create a replacement list. Original dates, receipts, source identity, contact eligibility windows, and paid admission are unchanged.

The targeted admission takes the same account advisory try-lock as ordinary claim, then the existing operating-budget row and the original preflight row with NOWAIT. Same-account ordinary renewal cannot invert that ordering. A quota denial or lock collision consumes no cleanup attempt. Every admitted attempt, including an unknown result, consumes the existing three-attempt cap and retains its original token. The global FIFO cleanup function is unchanged.

An exact source-bound cleanup deferral uses the existing consumed-ticket token, source hash, eight-deferral cap, 24-hour ceiling, and exponential backoff. It does not grant a fresh-list continuation marker. Every future worker must obtain current proof and pass ordinary renewal and purchase gates again.

## Rollout

1. Apply `20261114212434_owner_preflight_cleanup_handoff.sql` using the supported migration path, whose transaction covers both SQL and its migration ledger. The SQL has no top-level transaction control. It refuses unexpected predecessor claim/cleanup/renewal/evidence definitions and starts disabled.
2. Deploy the exact reviewed release containing the handler and route changes to all workers. Confirm deployment and required CI before activation.
3. In a reviewed administrative transaction call `icash_research_private.activate_owner_preflight_cleanup('<full deployed commit SHA>')` and require `true`. The private invoker function is unavailable to application roles. Under the existing operating-budget lock it verifies the complete stored hash set for the patched claim, cleanup admission/source/deferral functions, and original cleanup/renewal/source/request dependencies. Missing hashes, changed definitions, an invalid SHA, or any prior activation reject the change without modifying policy. No historical preflight or ticket updates are required.
4. Verify source-bound cleanup admissions and confirmed deletion, then ordinary successor generations. Compare original timestamps/receipt hashes and ensure no duplicate successor or purchase operation. Separately confirm ordinary FIFO cleanup continues.

Rollback disables the private policy. Already admitted cleanup attempts and saved receipts remain valid; never reset their counters or leases. The one-time activation function cannot reactivate a disabled prior release; a later rollout needs a separately reviewed migration.

## Verification

`tests/owner-preflight-cleanup-handoff.test.mjs` executes the actual preflight service against local SQL definitions with offline transport. It covers the pre-fix expired hold, held/no-ticket selector eligibility, exact deletion, one ordinary renewal, immutable original evidence, false/unknown/lost receipts, lease contention, quota-before-attempt, bounded deferral, Pause/funds/source/TTL denials, ACLs, and unchanged FIFO definition. `tests/owner-preflight-cleanup-activation.test.mjs` verifies every function hash, required manifests and evidence triggers, private role access, one-time activation, and atomic rollback of SQL plus its migration ledger. The native PostgreSQL runner separately exercises real concurrent transactions, serialized activation, and lock ordering. Existing preflight, indexing, renewal, and automation deferral suites remain required.

Installed at 21:24:34 UTC on November 14, 2026 as `20261114212434_owner_preflight_cleanup_handoff`. Readback at 21:24:46 UTC confirmed disabled policy, null release/activation fields, zero admissions, all 19 dependency hashes matched, and service-only public RPC execution. The private activation hash is `ff002988f430a62c6aaeee1d908bec88`. Do not reapply this migration. Exact-release verification and guarded activation remain pending.
