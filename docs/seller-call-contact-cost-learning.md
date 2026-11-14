# Seller contact cost learning

The November 14 change makes reviewed seller-call strategies comparable using a
complete, explicitly bounded `seller-contact-72h-v1` cost scope. It does not prove
that an approach improved, assign interest from queue success or measure total
acquisition cost. The same private helper supports new cash-question-v6 SMS
experiments.

Each trial is a property's first dispatched, prospectively assigned seller call.
The call reader binds the original account, screening, recipient, assignment,
strategy, recorded prompt and dispatched operation. Real direct calls dispatch
before their recording and live-conversation registration; those registration
timestamps cannot invalidate a valid earlier dispatch. Re-screening or contacting
another recipient does not create another trial. Earlier seller contact,
including uncertain earlier original clocks, prevents retrospective assignment.
Properties without deal files remain in the trial denominator. Failed calls,
unanswered calls and missing AI registration remain attempts with their original
costs; dispatch does not prove that the seller heard a question. Positive outcomes
still require separate source conversation evidence.

The 72-hour outcome and cost windows start at actual dispatch. Positive interest
uses existing source-bound call and SMS evidence, with opt-outs and refusals
preserved. Pending windows contribute to attempt and immediate safety counts but
do not add positive labels, costs or unresolved-cost penalties to the mature
comparison. Contracts at 30 days and closings at 60 days remain observations.
Their mature objective keeps priority but cannot select a winner using a 72-hour
cost denominator; SQL and TypeScript return `outcome_window_costs_incomplete`.

## Counted costs

The helper follows all screenings with the same account/property identity and
deduplicates original operation keys. It includes:

- Outgoing seller texts and actual SMS AI jobs.
- Recorded calls, live-only calls, admitted voice jobs and customer browser calls.
- Inbound recorded calls with immutable property/thread bindings; matching but
  unbound recorded or legacy inbound calls block completeness.
- Seller deal emails, purchase signing invitations and unknown property email
  parties that might be seller contact. Known title and buyer signer emails are
  outside this seller-contact scope.
- Paid seller reminder DNC revalidation through the original contact or gap/thread.
- Legacy signing-provider SMS resends as an unresolved cost gap until exact
  original billing attribution exists.

Completeness requires a nonempty graph of at most 10,000 operations, original
dispatch inside the window, a settled verified cost basis, nonnegative actual
provider and customer costs, and an ordered settlement with evidence reference.
Estimated costs, missing sources, ambiguous property attribution, missing clocks
and unmatched cancellations remain incomplete. The implementation does not
invent zero-cost cancellation receipts. Paid discovery before first contact and
later buyer/title/closing work are outside this declared scope.

## Verification and operation

`tests/seller-call-contact-cost-learning.test.mjs` runs the actual forward SQL
against synthetic receipts and asserts source coverage, duplicate-operation
handling, account/property/window isolation, no-deal denominators, actual call
chronology, prior-contact exclusion, pending-cost isolation, mature-objective
guards and service-only function execution. The fixture includes missing,
estimated and unknown costs; none can certify completeness.

`ICASH_LEARNING_BENCHMARK=1 node tests/seller-call-contact-cost-learning.test.mjs`
also refreshes 1,000 synthetic property trials. The latest local PGlite run took
4.0 seconds after selective property/thread indexes; this is a local SQL
measurement, not a production latency guarantee or the complete multi-account
refresh time. Existing production indexes were inspected read-only. The helper
caps counted operation keys at 10,001 and marks overflow incomplete.

The helper is a private service-only aggregate bridge because immutable inbound
bindings are intentionally unavailable through ordinary table reads. It returns
only counts, costs and completeness metadata, never contact identities or
provider payloads. The migration preserves legacy refreshes, existing allocation
thresholds, owner/test exclusions and all paid admission controls. Buyer-search
and seller-recovery full cost attribution remains unresolved.

Installation leaves seller-call cost eligibility disabled. After the exact
successful global learning release and evidence cutover, the canonical owner may
call `icash_activate_seller_contact_learning(owner, release_sha, true)` through
the existing service-only release path. The successful release must complete
after this migration's installation. A pre-install SHA, stale epoch, disabled
global policy or mismatched global release cannot activate this scope. The same
function with `false` disables only this scope's cost-based allocation eligibility
and preserves all underlying evidence and ordinary outreach.
