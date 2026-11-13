# Contact export recovery after a missing status write

A paid owner export can have an admitted request and an exact, durably ended contact handler while both request result and finish time remain null. The request metrics writer is best effort; a failed write must not leave all accounts permanently waiting for an export whose provider outcome is unknown. Existing unknown-export recovery required a saved `outcome: unknown` and finish timestamp, so it never considered this state.

The new `missing_finish_enabled` setting defaults false. When enabled alongside existing unknown recovery, the same source-bound free capacity review also accepts an admitted request whose result and finish time are **both** null. It requires exactly one matching contact handler, held for reconciliation after exactly one issue attempt, completed and expired at least five minutes ago. Admission must fall between batch creation and handler expiration and precede handler completion. Partial, conflicting, live or ambiguous source evidence stays held.

Recovery uses the existing immutable source snapshot and three fresh, quota-bound provider reads: complete inventory, pending exports and processing exports. Only verified idle capacity permits a capacity binding. It does not fabricate request status, mark the original purchase complete, release money or owners, replay a provider POST, or bypass customer admission. Original request nulls, handler, batch, export and financial evidence remain unchanged. Original late receipts continue through both existing writers and restore the global hold when appropriate.

## Verification

`node tests/unknown-export-capacity-database.test.mjs` covers staged defaults, missing/partial/conflicting status, exact handler chronology, changed controls and sources, stale/incomplete provider evidence, preserved original nulls and money, and ordinary unknown-response compatibility. `node tests/unknown-export-late-evidence.test.mjs` retains both production receipt writers.

`scripts/test-unknown-export-postgres.py` runs against disposable localhost PostgreSQL only. Run normally and again with `ICASH_TEST_MISSING_EXPORT_FINISH=1`; both are in canonical Reliability checks. Each mode exercises concurrent claims, probes and finalization, changes committed by other sessions, unchanged owner/money evidence, and late receipt isolation against real admission. All provider responses are synthetic; these tests perform no provider requests.

## Rollout

Apply the guarded migration with the setting false. The predecessor hash must match the installed source policy. After successful exact-head checks, the normal automatic release, exact-main production readiness and worker verification, enable only `export_capacity_automation.missing_finish_enabled` under the existing organization owner-export advisory lock. The ordinary maintenance worker performs the free review. Observe a verified review and subsequent ordinary production receipts separately; a capacity release alone is not completed outreach or a sale.

Disable the new setting to stop future missing-status reviews. Do not erase completed reviews, original evidence or late holds. The current interface is unchanged.
