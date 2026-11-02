# Automatic offer and deal progression

Seller asking prices are negotiation inputs. They are neither an accepted offer nor a reason to require the customer to calculate a counteroffer. The existing owner-selected formula remains `(ARV - repairs) × 70% - fee`, with its existing rounding and financial checks. A higher seller ask produces the supported cash proposal; a lower ask can reduce that proposal. Existing accepted prices and prepared/signed agreements remain exact.

## Evidenced failures and scope

- The voice offer calculator rejected any seller ask above its ceiling, returning `seller_price_needs_review` without a price. It already had sufficient data to calculate a supported counteroffer.
- The SMS path had qualification/FAQ replies but no numeric-offer-to-agreement executor. Historical price statements, a saved proposed price and human negotiation often produced a blanket reconciliation hold.
- The buyer reply queue rejected a body that had ever been sent on the thread. A subsequent legitimate question could leave a drafted job. Some approved factual answers also exceeded the transport's single-segment limit.
- Automatic signing could read terms changed after confirmation. Automatic seller sending now passes the exact expected terms; the signing service rejects changed terms before provider preparation, and the existing envelope hash detects a change during the final database claim.

The November 2 customer audit previously covered 19 customer seller SMS threads, 1,538 completed outbound customer calls and 23 inbound calls. Nine owner SMS threads were excluded. Floral City and Rockport had stranded repeated-callback drafts; Memphis had no reply job after its ownership-stage price question, before its later Pause. That historical evidence and the original source receipts remain intact.

The expanded downstream read-only audit found **zero customer buyer reply jobs, zero customer signing envelopes and zero recorded customer voice seller-price updates**. All seven live purchase envelopes belong to the owner account: two completed, one waiting for the customer signature, one awaiting the seller and three requiring receipt/review work. There is one closed buyer journey, three reviewed buyer requests, no showings, no title-opening requests, two sent title-qualification inquiries and four cancelled title tasks. These are inventory counts, not customer closing results. The new buyer/voice negotiation defects are verified with code and fixtures; do not claim additional historical customer failures without evidence.

## Execution

`seller-text-offer.ts` consumes server-bound messages, delivered questions and completed call history. It reuses the automatic offer, qualification, payoff, identity and agreement-evidence validators. It distinguishes an asking price from acceptance of the exact delivered proposal. It asks only for missing qualification, legal name, owners, closing date, inspection preference and final terms/text permission. Routine price differences do not require a customer approval. Net-price ambiguity is clarified; real property changes and additional required signers retain specific next steps.

The SQL executor uses the same private offer/version ledger as voice. A source can create one outgoing operation or one agreement claim. Source ID, account, thread, original route, full recent conversation, property snapshot, current terms and offer version are checked again before saving and dispatch. An active seller call waits for its actual completion; uncertain receipts cannot authorize another channel's answer. Calls requested by the seller continue through the existing immediate/scheduled-call workflow.

Messages use the existing SMS transport and approved segment size. There is no model fee for deterministic execution. Final provider admission still checks Pause, manual control, current recipient eligibility, routing, membership, funding and original operation receipts. A pending delivery waits on the original receipt; failed or unresolved delivery is not replayed. A generated message does not mean delivery.

After actual acceptance, the executor verifies identity and exact terms, claims the existing agreement ledger, invokes the existing signing service once and delivers through the existing contract-text service. A verbal agreement does not establish a signature. Existing verified-signature fulfillment then prepares buyer disposition, searches/matches buyers, coordinates buyer details and assignments, obtains both parties' showing confirmation and coordinates title through verified contacts. Buyer outbound contact remains SMS/email; inbound buyer calls and permitted seller calls remain supported.

Buyer counteroffers receive the current published asking price and a useful question. The bot cannot invent a discount, disclose acquisition pricing or verify funds from a claim. Later repeated factual questions can be answered without reusing an old provider operation. Unhandled buyer replies receive a durable progress/attention reason. Provider receipt reconciliation runs through the bounded maintenance loop.

## Verification and release

`tests/seller-text-offer.test.mjs` runs the actual SQL source/resume/save/final-admission functions with the real TypeScript planner and service. It covers high/lower asks, conflicting saved proposals, acceptance, confirmations, one signing claim, duplicate webhooks, failed/missing/late receipts, historical messages, changed underwriting, customer edits, Pause, expired checks, tenant boundaries, buyer counteroffers/repeated questions and private RPC permissions. Providers are replaced by offline fixtures.

`scripts/test-seller-progress-postgres.py` adds 16 concurrent duplicate price webhooks, 16 competing saved plans, 16 final claims and concurrent Pause on native PostgreSQL 17.6. Existing dialogue/recovery, live-agreement-route, signing-service, buyer journey, immediate seller callback and title snapshot/follow-up suites exercise connected paths. The callback fixture covers 56 scenarios; the buyer journey fixture covers seven groups including verified signing/deposit/title and two-party showings.

Install the SQL inactive. Enable `offer_enabled` and `buyer_reply_enabled` only after the exact code passes CI and matching web/worker deployments are healthy. Set each activation timestamp once; only subsequent fresh seller/buyer sources enter the new deterministic lane. No historical negotiation, pause, consent, offer authority, signing envelope or provider receipt is reset. Disabling the flags stops new automatic preparation while retaining the original evidence.

Historical Floral City still requires current underwriting and property/price reconciliation before any commitment. Rockport still needs fresh contact checks before a new clarification or visit coordination. Memphis remains paused. No outreach or agreement is sent to demonstrate this release. Production continuation must be reported separately from fixture success and deployment.
