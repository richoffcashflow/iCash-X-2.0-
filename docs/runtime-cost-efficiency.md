# Runtime cost efficiency

This release reduces unchanged background work and repeated build verification. It also adds a private cost-evidence breakdown to the owner overview. It does not change customer prices, provider plans, concurrency, contact eligibility or historical charges.

## Recovery

Primary completions with explicitly idle outcomes no longer enqueue another account reconciliation. Meaningful primary results, held primary outcomes, operation state changes, new cost observations and completed conversation evidence still durably wake the existing account queue. Repeated receipt acknowledgments and fairness timestamps do not wake themselves.

The existing generation-bound lease and one-use ticket remain authoritative. Fresh pending operations retain a five-minute fallback. Successful unchanged recovery for operations older than a day backs off through 15 minutes, one hour and six hours. Errors retry after one, five and then fifteen minutes. An actual new receipt overrides those delays and resets only the exact operation's receipt-check cursor; it never releases a financial hold or retries a purchase, call or text. Evidence arriving during a claim remains queued for another pass.

The customer-update scheduler checks for an eligible, unsent source before allocating a handler. Its bounded scan advances even when idle. Final claim and send authorization still enforce the original ownership, consent, suppression, sender, lifecycle-frequency, channel and deduplication checks. Immediate notifications from actual activity remain intact.

Signing envelopes retain the original ten-minute provider poll for manual and authorized signatures. An immediate provider webhook is not established by this release, so slowing those polls could delay a newly signed deal. Unchanged signing results no longer enqueue redundant account reconciliation.

## Cost reporting

The owner-only report uses the same Central calendar-day, owner-inclusion and payment-test exclusions as the existing overview. It separates explicit verified, estimated and unclassified component amounts, shows missing/mismatched breakdowns and counts only the canonical DealMachine observation for each settled operation. People and deduplicated subtotals are never added to that total. Missing data is unavailable, not zero profit.

This is an evidence-quality view, not invoice reconciliation. Included plan credits, subscription fees, unused capacity, supplier invoices and actual processor fees still require matching external records before calculating real profit. Historical costs and multipliers are immutable. No new rate is inferred from public plan prices.

## Build verification

The `all-tests` job still discovers every offline suite. The independent CI build retains browser and concurrency checks, while Vercel still requires a successful main-push workflow for its exact production commit. CI build and Vercel no longer repeat the offline suite through `build:verified`. Provider setup/readback stays behind the original production gate. This removes repeated tests; it does not claim the entire earlier projected build saving or eliminate the host-side wait.

## Release and validation

Apply `runtime_cost_efficiency` and `owner_cost_evidence` after focused SQL/route tests and successful required CI. Both migrations are compatible with the existing application. Runtime migration validates original function checksums before changing selector behavior. Publish the matching web release, then verify the production commit, private function privileges, recovery timestamps, queue completions and ordinary health probes. Use offline fixtures; no development provider calls or messages.

Regression scenarios cover idle-loop reproduction, new/old/error retries, new receipts during a claim, exact-operation wakeups, stale and cross-account claims, unchanged money, current notification consent variants and caps, signature intervals, canonical credits, account scope and incomplete accounting. Browser coverage includes desktop/mobile cost breakdowns and unavailable evidence.

Compare completed useful operations, inbound latency, receipt settlement delay, reconciliation count and billed build CPU over equivalent demand windows. Slower or stopped outreach is not a saving. Dollar savings remain unproven until billing and production measurements accumulate.

Data targeting and best-number experiments require their separate measured rollout. Do not globally enable dormant filters, invent buyer requirements, train on unverified outcome labels, reduce a productive live conversation's duration or buy a different provider plan as part of this release.

## Rollback

An application rollback is compatible with both additive migrations. For runtime rollback, restore the original `enqueue_account_followup`, `icash_finish_account_followup` and `icash_next_before_seller_continuation` definitions from the pre-release snapshot; remove only the three `icash_followup_*` receipt triggers. Move delayed, unleased account-followup rows to at most five minutes away. Retain every operation, receipt, money hold, lease generation and accounting row. The added counters and read-only cost report can remain installed. Never reset customer work to replay it.
