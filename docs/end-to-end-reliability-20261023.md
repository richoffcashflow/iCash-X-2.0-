# End-to-end reliability repair — October 23, 2026

The live audit found repeated discovery tickets for an unresolved provider page,
incorrect duplicate counters, automated audio counted as seller responses,
browser calls rejected at the bridge, and release checks failing on API limits.

## Changes

- Discovery admission excludes an already dispatched current page. Its financial
  hold remains; enrichment and other accounts remain eligible.
- Inventory counters use explicit property aliases. Historical derived counts
  are repaired using assignments that existed at receipt time. Original provider
  results, usage receipts and credit ledger entries are unchanged.
- Call outcomes exclude punctuation-only transcripts, audio markers, automated
  greetings and screening prompts. Real source-word opt-outs remain effective;
  the full transcript remains saved. False interest, callback and handoff model
  flags cannot create actions from an automated answer.
- Runtime seller prompts direct the existing end-call tool to end automated
  answers and stop repeating questions after unanswered turns. This is a prompt
  improvement, not a guaranteed real-time answering-machine detector.
- The opportunity aggregate includes the existing receipt-backed SMS selling
  interest predicate. Ownership-only confirmations still do not count.
- Signed callbacks recover a fresh, canonically bound browser parent from an
  incomplete dispatch response before the existing single-use bridge gate.
  Ended calls, expired starts, mismatched parents and blocked contacts stay held.
- Carrier reconciliation claims a persisted retry timestamp before reading the
  provider, so failures and missing prices cannot monopolize maintenance.
- Production release checks poll once per minute, allow 20 minutes for CI,
  honor a known rate-limit reset, and support an optional server-only
  `ICASH_RELEASE_GITHUB_TOKEN` with read access to repository Actions. Exact main
  commit identity and successful checks remain mandatory; unknown access fails.

## Verification coverage

| Boundary | Offline scenario coverage |
| --- | --- |
| Funding → work | Paid access, immediate starter, fixed 50% allowance, 12-hour release, hourly/daily ceilings, Pause |
| Discovery → research | New/mixed/duplicate pages, exclusive account assignment, uncertain provider outcome, tenant scope |
| Call → response | Voicemail, screening, silence, real person after screening, opt-out, false model flags |
| Manual call → seller | Signed callback, canonical parent, incomplete dispatch, expired/ended call, single-use bridge |
| Seller → offer | Ownership, co-owner, repair/debt changes, accepted price, return-call history |
| Offer → purchase | Exact terms, delivery receipts, seller-only signature hold, required signatures |
| Purchase → buyer | SMS/email outreach, private pricing, unchanged accepted terms, stale/reserved listing holds |
| Buyer → closing | Deposit evidence, verified title contact, payoff review, closing/payout confirmations |
| Usage → settlement | Complete cost evidence, duplicate-safe settlement, unknown holds and fair retries |
| Code → production | Full test runner, build, rendered browser checks and exact-commit CI release gate |

These are regression scenarios using synthetic local evidence. They are not
claims that real sellers signed, buyers paid deposits, or closings occurred.
No paid development calls, messages or provider simulations are authorized by
this release. Production receipt inspection only reads up to three existing
carrier calls and stores minimal private diagnostic metadata; it expires on
October 24, 2026 at 7 PM Central.

## Rollout and limits

Apply the three additive migrations in timestamp order before releasing the web
build that reads `reconciliation_checked_at`. Derived opportunity history is
invalidated and refreshed through the existing bounded account refresh path.
Preserve all historical uncertain operations until actual provider evidence
supports reconciliation. Missing carrier prices are not inferred as zero.
Observe ordinary authorized production activity after deployment to confirm the
manual-call recovery and shorter automated-answer handling; offline tests cannot
establish live audio quality or guarantee a flawless external-provider outcome.
