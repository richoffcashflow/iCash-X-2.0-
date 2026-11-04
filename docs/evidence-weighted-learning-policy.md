# Evidence-weighted learning policy

`evidence-v2` changes future allocations among reviewed alternatives. Existing
conversation identities, assignments, messages, provider receipts and model
receipts remain unchanged. Installation does not activate the policy.

A shared winner requires at least three contributing accounts and 100 resolved
observations per compared arm, complete positive cost evidence, and at least ten
interest outcomes or five verified contract/closing outcomes for the winner.
The winner's 95% Wilson lower bound, converted to outcomes per settled customer
cent and penalized for opt-outs, must exceed every competitor's upper bound by
more than 5%. The most mature supported objective takes precedence; insufficient
closing outcomes cannot be bypassed by switching to interest. These are
observational allocation rules, not measured causal lift or profit.

Pending attempts are excluded from both the resolved success-rate denominator
and its reward multiplier. A single safe reviewed choice can receive exploratory
allocation without declaring a winner. An arm with at least 20 attempts, three
opt-outs and an opt-out rate over 5% is excluded from learned and exploratory
slots. If no safe arm remains, the actual allocator returns an explicit hold;
voice and buyer services stop before financial reservation or provider work.
Historical assignment absence remains distinct from this hold.

Each account's shared contribution is capped at 200 weighted observations.
Aggregates older than six hours or predating the current evidence epoch are
unavailable. Unknown-owner accounts, the canonical owner's demonstration account,
and accounts with only paid test-mode funding cannot contribute to peers.
An account with genuine live funding is not permanently excluded by older test
funding. No owner identity or message content enters the aggregate response.

## Cost scope

Current seller-call rollups cover the selected first-call charge, buyer-search
rollups cover search charges, and seller-recovery rollups cover the first recovery
text. Their historical sums remain visible, but `costs_complete` is explicitly
false for allocation. These domains remain exploratory until full attributed cost
measurements are implemented. A healthy learning job is not evidence that a
cost-based winner exists. Reviewed seller SMS and targeting cohorts can qualify
only through their own complete, original-cost evidence and outcome windows.

## Prospective assignments and evidence

A stable 20% account comparison cohort keeps balanced exploration. For other
accounts, a qualified winner receives three of five policy slots and challengers
receive the remaining slots. Local discovery similarly excludes the winner from
challenger slots, while preserving cold-start preference and bounded duplicate
probes. No allocation changes recipient permission, Pause, rate, quota, funds,
provider identity, unknown-operation fences or final paid admission.

The service-only decision recorder accepts only reviewed domain/context/market
and choice combinations. Submitted statistics must exactly match the canonical
aggregate reader. Immutable evidence deduplicates within the same snapshot hour,
evidence epoch and release SHA; a new release/cutover cannot inherit an old
empty-cohort decision. The later lifecycle recorder records actual held allocation
separately from read-only previews. Existing historical assignments cannot be
retrofitted with new policy evidence.

## Verification

`tests/evidence-weighted-policy-database.test.mjs` executes the real migration
against its exact saved prerequisite definitions. It covers SQL/TypeScript parity,
weighted and extreme counts, missing/malformed evidence, canonical recording,
owner/test exclusion, partial cost refusal, source freshness, safety holds,
private access, and stable historical assignment identities. A clearly marked
synthetic complete-cost source exercises 5,000 prospective allocations and the
comparison cohort; it does not claim that the current partial-cost readers are
complete. Separate buyer and voice service tests verify pre-spend holds.

Apply `20261104052433_evidence_weighted_learning_policy.sql` before the dependent
seller-SMS and lifecycle migrations. The final cutover invalidates only derived
cache freshness and obsolete training leases, then ordinary bounded refresh jobs
recompute evidence. Activation requires the reviewed release and its existing
verification gates. Never force a winner, fabricate costs, replay outreach or
lower qualification thresholds to make a report appear active.
