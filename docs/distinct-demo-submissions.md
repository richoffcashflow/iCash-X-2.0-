# Distinct owner demo submissions

Every intentional Test your bot submission has a new request ID. It creates its
own intake, research receipt, seller match and screening, even when its address,
phone and provider property ID match an earlier visible demo. No manual archive
or reset is required to establish a new run. The existing Start a new demo
control is available after terminal saved outcomes and clears the request key
and consent checkbox while keeping the entered details.

An uncertain network response, accidental double click or replay of the same
request is not new intent. The client retains its request key for retries. The
intake RPC serializes on that key, compares the original payload, and returns
the original receipt. Changing the payload while reusing its key is rejected.
The original lookup claim and per-lead assignment still consume exactly once.
Historical duplicate receipts are not rewritten or revived.

Only the demo branch loses address/phone and provider-property canonicalization.
Real seller property deduplication and the separation between public requests,
private demos and different accounts remain. The current Meta wrapper continues
to call the same underlying lookup finalizer and retains promotion behavior.
Installation does not rewrite history or start work. Prospective source-bound
lifecycle activation may retire only safe earlier owner self-demo sources. It
preserves provider receipts, funds, signed terms, opt-outs and unknown holds.

## Composition boundaries

Distinct identity alone does not guarantee a call. Ordinary access, funding,
provider setup, consent, Run/Pause and final admission checks remain. A prior
active or uncertain call still blocks another dial. Older requests do not gain
a new five-minute call-now window. The API retains five NEW intents per hour per IP and owner. Exact validated
retries do not consume that allowance. A separate sixty-total-attempts/hour
guard bounds abuse. Readiness establishes the guest cookie before POST can
create work, so a lost first POST response remains safely retryable.

New screens do not reuse prior deal files or signing terms. The atomic bundle includes source-bound lifecycle activation and compatible
voice/SMS sender selection. Only the newest exact owner self-demo can activate;
active or unknown earlier operations must settle first, within the original
five-minute request. Ambiguous late replies cannot attach to a new same-address
run. STOP remains binding. Ranking uses outgoing transport evidence, not proof
of bidirectional SMS or handset receipt. It never enables a sender.

## Verification and release

Install only config/owner-demo-restart.sql and its identical migration after
PR654. The four component configs are source artifacts, not independent release
steps. The canonical body has no top-level transaction controls: Supabase
apply_migration owns BEGIN, unchanged body, receipt insertion and COMMIT. For
psql use --single-transaction. Do not install a component separately. Lifecycle
guards intentionally reject a second install. Exact-head checks and independent
review are required; no paid call, queue replay or production mutation is part
of offline verification.

Offline tests cover the actual client handlers, repeated equal-detail intents,
uncertain retries, real intake/lookup/assignment SQL, active historical screens,
account isolation, STOP/contact opt-outs, legacy receipt retention, current Meta
wrapper and private ACLs. Existing call-spacing and call-now tests retain expired
and unknown-attempt holds. The native PostgreSQL test runs 12 concurrent retries,
12 distinct requests and concurrent equal-property finalizers in the fixed
isolated Reliability database. Loading that fixture in PGlite is syntax coverage,
not a substitute for native concurrency execution.

The combined test executes actual lookup, current contact preparation, selector,
permission, phone/hour delegates and captured final reservation/dial functions.
External eligibility and credit calculation are explicit offline boundaries.
Late predecessor drift and simulated migration receipt collision both roll back
the complete bundle. Native tests additionally contest actual reservation and
final dial claims against retirement and unknown earlier attempts.
