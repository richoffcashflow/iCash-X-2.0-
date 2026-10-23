# Close conversion upgrades

This release increases eligible call capacity, uses current buyer criteria in sourcing, adds buyer feedback and a private fee approval, and activates the seven reviewed seller follow-up variants.

## Calling

Normal incoming and outbound claims share the operating-budget row lock. Admission counts distinct operations across issued/dispatching jobs, unreconciled outcomes, live conversations and recordings. Unknown outcomes retain capacity until receipt reconciliation. A recurring, read-only provider check verifies the subscription tier and agent concurrency with bursting disabled. The launch ceiling is four calls across the workspace, with one slot reserved from outbound work for incoming calls. When one agent serves both directions, its capacity also reserves an incoming slot; dedicated outbound agents may use their full verified limit. An account can have up to three outbound calls, scaled from its current balance and existing allowance. The existing financial admission, calling hours, account fairness and contact exclusions still decide whether each call may start. No provider plan, burst setting or historical recording configuration is changed.

Capacity evidence expires after 24 hours; missing evidence falls back to one shared slot. Quick-test reception keeps its existing singleton rule. The maintenance response reports verification status; `icash_voice_capacity_policy` and `icash_voice_agent_capacity` record the readback time and effective limits. A provider limit of one remains one.

## Buyer demand and recovery

Buyers can state how many properties they can buy over the next 30 days. Existing profiles retain unknown capacity. Only current, verified-email, unsuppressed buying profiles contribute; a ZIP needs at least three qualifying buyers before aggregate signals appear. Budgets and repair limits affect property selection before contact research; current demand also affects rotation among already authorized inventory markets. Financial eligibility and purchasing budgets remain prerequisites.

Buyers can submit a whole-$1,000 suggested price or a reason a deal does not fit. Feedback is account/deal-bound, replay-safe, and never accepts or changes a price. The customer sees the price gap and the concern in the Buyers area.

For an unreleased, under-contract deal that cannot support the normal minimum, the customer can explicitly approve a property-specific $5,000–$10,000 minimum in $1,000 increments. Approval checks the current terms hash and saves the actor, previous terms and resulting terms. The normal target and 70%-after-repairs ceiling still apply. Published packages, existing disposition authorities and issued assignment agreements prohibit this shortcut. Original signed purchase terms remain unchanged. Fees stay private in buyer packages, messages and conversations; the original assignment contract retains its approved fee disclosure.

## Seller follow-up

Only `unanswered-v1`, `unanswered-v2`, `repeat-v1`, `no-response-v1`, `no-response-v2`, `viewing-v1` and `viewing-v2` are activated. Existing source receipts, reply cancellation, opt-outs, manual takeover, pause, contact hours, repetition limits and credits remain enforced at dispatch. Sensitive ownership, legal/material facts, human requests and unknown delivery remain review cases. Existing learning only selects among the reviewed variants.

## Verification and rollback

The release suites include real isolated PostgreSQL admission, pricing, buyer-demand and feedback tests, plus authenticated route tests. Tests make no paid calls, send no messages and invoke no provider simulations. Existing seller recovery integration covers reply-before-send, opt-outs, repeated attempts, signing replays and ambiguous delivery.

To reduce concurrency without altering any call, lower the capacity policy to one; existing calls are not terminated. To pause the new automatic follow-ups, disable only the seven named variants without deleting gaps or receipts. Application rollback retains additive schema and historical approval/feedback records. Published prices, accepted terms and provider outcomes must never be rewritten as a rollback.
