# Recovery hardening — November 2, 2026

The owner requested continuing after the first recovery release because 34 funded accounts still had no completed work and 51 had pending commitments at 23:14 UTC. Healthy worker and maintenance heartbeats did not mean those accounts had recovered.

## Confirmed failures

* Acquisition could select a batch sibling that already had a dispatched owner operation but no individual automation ticket. The batch admission correctly rejected it, yet selection repeatedly returned the same property ahead of other eligible work. Filter that existing evidence before ranking; retain the original operation, same-property protections and all final admission checks.
* Temporary owner-list cleanup used a five-minute handler age for waiting lists. Successful delayed counts had a measured median of about five and a half minutes. Preserve known-created lists and their exact source-bound cohorts through the existing bounded evidence window, while retaining the shorter handling window for interrupted or unknown requests. This does not shorten indexing or relax phone filters.
* One original successful export contained three valid contact rows and reported three used credits, but one owner display name was blank. The parser rejected the entire artifact. Preserve the blank name honestly and continue to require exact person/property ownership, active/DNC-filtered phone evidence and original reported-credit allocation.
* Eight unconnected browser parent calls had no-answer or busy carrier results, no child, no recording and no connection, but a null carrier price prevented settlement. Only canonical unanswered evidence plus fresh complete empty child and recording inventories can establish this narrow no-charge outcome. Completed calls, ambiguous inventory, contradictory prices, later children and recordings remain held.

## Saved-artifact recovery

The first review found nineteen historical contact tickets across fourteen stalled accounts held after a free list was deleted before its deferred handler completed. Preventing early cleanup alone does not revive those tickets. A disabled service-only repair requires exact original ticket, preflight, configuration and approved-rate evidence; confirmed cleanup; current renewal eligibility; and unchanged source, funds, membership, Pause, phone pool and unstarted-operation checks. It archives the full original evidence privately and retains the token, deferral count, deadline and original price cap. Only the ordinary scheduler can issue the next capability. A rolled-back production check at 23:32 UTC found thirty currently eligible tickets across twenty stalled accounts; the switch and archive remained unchanged after rollback.

The failed parsing attempt exhausted the existing provider-recovery budget. A separate disabled switch and bounded local retry counter allow the original complete, hashed CSV to be processed again without requesting or buying provider data. Original receipts, artifact bytes and provider attempt counts remain unchanged. A local-only claim must fail closed if its saved artifact is unavailable. Enable only after the matching production release passes required checks and both hosts are verified.

## Verification and limits

Behavioral fixtures must reproduce each failure and its adjacent rejection cases. Native PostgreSQL tests cover competing local recovery claims, historical ticket recovery versus customer Pause, unanswered call settlement versus late connection evidence, and the real database candidate/cleanup functions. Existing full-suite, browser, dependency and production release gates remain required.

Verify recovery from ordinary production receipts rather than paid development calls, texts or purchases. Missing historical charges and uncertain provider outcomes remain unresolved; do not clear them to make the outage indicator green. Late actual carrier connectivity prices need an independently reviewed evidence path and do not justify replacing the existing frozen tariff/country policy in this repair.

The separate ten calls with a priced parent and unanswered child need their own child-specific evidence and race coverage; the parent-only no-charge repair does not settle them. Preserve the recorded parent and audio costs.
