# Seller reply progression audit — November 2, 2026

Production and open work were inspected before implementation. The baseline was
main `861892014a191f66d83a3b31ef09cec2f30f923e`, also the ready Vercel production
commit. The worker was on `a253711` (the later frontend/data changes did not
require a worker build). Open PR #485 contains separate online-contract support
instructions; those changes are not duplicated here. Recent acquisition,
receipt, cost, contract-form and learning fixes remain intact.

## Evidenced failures

Two customer conversations retained `ask_callback` drafts without outgoing
message IDs. The first callback already had a provider delivery receipt. The
planner selected the same action again; both the legacy queue and the newer
bound seller conversation lane reject repeated questions. The service returned
`text_ai_drafted` after that rejection. The scheduler selected pending and stale
issued jobs, never drafted jobs. Thus a correct duplicate guard became a silent
dead end rather than an alternative action or a review item.

In the price-acceptance conversation, the customer authored the price proposal
and assignment-fee explanation. The AI did not negotiate the accepted price.
The seller's $210,000 response conflicts with a $215,000 saved proposal and an
older $129,384 model ceiling. An earlier call also raises property-scope issues.
None is offer authority. The second seller required no third parties and asked
for a visit; neither a callback nor a photo request resolves that condition.
There was no showing request or signing envelope in those cases.

The third customer replied “How much” to an ownership opener. The campaign
enqueue branch called `icash_prepare_sms_inbound_reply` and returned regardless
of its result. That helper correctly declined to treat the price question as an
ownership affirmation, but returned null without a reply job or review item.
There was no Pause event before the inbound message. Later Pause events cannot
explain the original loss; the current Pause must remain in effect.

The reproduction fixtures contain the actual production function definitions
for these branches, without customer records. They demonstrate both original
failures before applying the migration. Historical messages and delivery IDs
support the observed outcomes; the database has no separate log proving which
individual null-return predicate ran on the historical request.

## Scope and recovery classification

The read-only audit covered all 28 seller text threads with received messages,
plus all seven completed live seller calls selected by the existing selling-
interest predicate. Nine text threads and two calls belong to the owner account
and are excluded from customer recovery counts. Repeated property addresses
in different accounts were kept separate.

The 19 customer text threads consist of six possible continuations, seven
refusals/opt-outs, five carrier responses and one ambiguous unbound reply.
All six possible continuations fail current contact checks: two need price or
buyer-model decisions, one is account-paused, one is under manual takeover,
and two need current context/contact checks before any follow-up. The two
stranded drafted jobs are included in those six. The ownership-stage price
question and a separate callback statement had no AI job.

The five customer interest-signal calls include one overlapping text case and
four additional properties. One additional call contains a later refusal and
must not be counted as safely interested. The other three require qualification
and current checks; their existing seller-gap records and delivery history must
be reviewed rather than duplicated. These are nine potentially continuable
customer property/account cases in total, not nine qualified or contract-ready
deals. Zero are eligible for blind historical replay.

## Implementation and invariants

`icash_seller_reply_progress` binds an observation to the original inbound
message, account, thread and property. It records source-backed answered facts,
attempted actions, customer-authored messages, seller price/visit/third-party
conditions, current blockers, milestone and actual outgoing receipt state.
Proposals, model estimates and authority remain separate. This table never
grants contact, purchasing or signature authority.

The inbound observer runs after the existing routing trigger, including its
null-return paths. Unrouted questions receive a visible customer review item.
The existing campaign-reply attention fix remains in place; when it already
created a source-bound review, this observer enriches that item instead of
creating a second card. Provider event time prevents delayed older webhooks
from replacing the current source.
The planner chooses a still-missing qualification question instead of another
default callback. SQL still derives the outbound copy and performs final
admission. A blocked action records a specific review reason. Agreement,
signature and title issues route to the existing authorized workflows; the
signed-purchase viewing lane is preserved.

Fresh saved drafts can resume from their original analysis, once, using the
existing source/idempotency key. Recovery never re-runs a potentially charged
analysis, changes a source timestamp, clears Pause/takeover or renews checks.
Old negotiations are review-only. An unreceived provider result cannot be
replayed. Provider acceptance waits for its original delivery receipt; delivery
waits for the seller, with a follow-up review deadline. A late receipt updates
the same observation and clears the obsolete receipt-review card. Reconciliation
is bounded and runs after provider writer transactions, preserving lock order.

Review cards show the concrete next step. Acknowledging one does not send,
authorize an offer, renew eligibility or change customer controls. Service-only
permissions and account/source fences cover every new RPC and table.

## Validation and release

Focused fixtures cover the three reported scenarios, human negotiation,
conflicting prices, duplicate inbound receipts, repeated actions, failed and
missing provider receipts, late delivery, delivered-message follow-up, source
supersession, expired contact checks, Pause, takeover, cross-account access,
saved-draft recovery, missing ownership, qualification, offer authority,
signature/title review and preserved signed-purchase viewing.

`scripts/test-seller-progress-postgres.py` additionally uses independent native
PostgreSQL sessions to race 16 webhook inserts, 16 draft recoveries and 16 final
dispatch claims, plus late receipts and concurrent Pause. It only connects to
the disposable localhost fixture database. The reliability workflow runs it
on PostgreSQL 17.6. Local verification also ran it on an isolated PostgreSQL 18
instance without provider traffic.

Install the migration inactive, deploy the matching API through the exact-main-
commit reliability gate, then enable `icash_seller_progress_settings`. Verify
the deployed commit, function permissions, latest-source review reasons,
unchanged customer controls and no historical outbound creations. Historical
backfill calls only `icash_refresh_seller_reply_progress`; it must not issue
provider tickets or create offers, visits or envelopes merely to prove the fix.

Rollback is disabling the setting, which makes the queue/claim wrappers delegate
to their original functions. Retain the ledger and review evidence. Do not
delete receipts or revert newer production migrations.
