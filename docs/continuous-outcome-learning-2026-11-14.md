# Continuous outbound outcome learning

The November 14 request is to learn faster and continuously compare approaches throughout outbound acquisition and deal progression. This release repairs concrete gaps in the existing learning system. It does not establish improved conversion or deploy an unqualified predictive model.

## Reproduced gaps

- The current cash-question-v6 seller openings use three reviewed alternatives but bypass the evidence-v2 feedback and allocation lifecycle. The canonical SMS-interest reader follows a legacy message pointer that v6 intentionally does not create, so direct answers to the current questions cannot teach that reader.
- The property-model export repeatedly takes the same 5,000 examples. At the November 14 17:56 UTC observation, both recorded positive examples were outside its selection (global ranks 5,253 and 6,404). This is selection starvation, not evidence that a model trained on two positives would qualify.
- Seller-call learning reports only the first call's costs and deliberately marks its cost evidence incomplete. It therefore cannot select an economic winner. Later contact costs and actual dispatch/maturity must be attributed before comparing approaches.
- The source parser rejects a narrow class of explicit first-person cash-offer declarations accompanied by price questions. A read-only replay of 4,862 recent completed customer seller calls still has three positives before and after the correction; the observed declaration followed by an opt-out correctly remains negative. No additional recovered seller is claimed.
- The targeting evidence reader requires dispatch to follow conversation/recording registration, although the normal call flow registers these rows after dispatch. Two narrowly guarded comparisons now use the original operation's creation time. The actual production SQL reproduces the lost attempts; account, property, provider identity, query policy, page window, maturity and cost checks remain intact. The separate property-ranker reader already uses the correct dispatch clock.

## Behavior

Property training runs every 15 minutes, with the original bounded CPU training, one database lease, maximum 5,000 examples and 200 examples per account. Least-recently-exported evidence rotates independently of success labels. Age bands and property-disjoint chronological validation remain in place. Training receipts report eligible, selected, newly covered and remaining unseen examples. The original positive-count, prediction-quality, account-holdout, expiry and 15% ranking-influence requirements remain authoritative.

Current text openings can use the same verified outcome comparison as the existing learning policy. New allocations retain a stable 20% account control group and, only after a candidate qualifies, at most 60% allocation to the winner with continued challenger traffic. Actual assignment decisions remain immutable. A source-bound delivered question and an unambiguous answer establish interest; ownership answers, voicemail, price questions alone, conditional answers and later refusal/opt-out evidence must not masquerade as successful seller acquisition.

Seller call and text experiments compare the completed 72-hour seller-contact window, including supported text, text-AI, call, reception, email, signing-invitation and reminder DNC receipts. Actual dispatched failures remain trials with their costs; a missing AI conversation or failed delivery cannot make an approach look cheaper by disappearing from its denominator. Missing, ambiguous or estimated costs remain incomplete. This is a named contact-cost scope, not total acquisition or closing cost. Longer contract/closing outcomes remain separately recorded; an incomplete longer cost scope cannot promote a deal-economics winner or silently fall back to an easier proxy.

Ordinary learning refresh, existing targeting, seller recovery, buyer search and verified purchase/assignment/title/closing evidence continue through their existing paths. Buyer/recovery cost gaps are not declared fixed by this release. No arbitrary prompt rewriting, new financial terms, contact permission, paid demonstrations or customer UI changes are introduced.

## Ordered release

1. Run the new actual-SQL and source-parity suites, existing affected suites, TypeScript, build and native concurrency checks; independently review the complete integrated diff.
2. Inspect the exact deployed predecessors and install only these reviewed migrations in order: `20261114182432_seller_call_contact_cost_learning`, `20261114182439_seller_interest_cash_offer_statements`, `20261114182442_ranker_continuous_evidence`, `20261114182940_cash_question_learning`, `20261114182949_targeting_call_exposure_clocks`. Do not replay unrelated pending repository migrations.
3. Both new allocation gates install disabled. Capture before/after function and ACL evidence, queue health and report timings. Derived labels may reflect original saved evidence; original messages, assignments, provider receipts and financial records remain unchanged. The successful release CI must complete after both migrations' installation timestamps.
4. Use the normal `auto-release` process, exact-head Reliability checks, expected-head merge and exact-main production verification. Preserve other pending owner-requested releases.
5. Register the successful exact-main Reliability receipt through the existing canonical learning-release procedure, invalidate only derived learning freshness under its existing cutover, and activate the matching global policy. Call both owner-bound service-only functions, `icash_activate_seller_contact_learning(owner, release_sha, true)` and `icash_activate_cash_question_learning(owner, release_sha, true)`, for that same verified release; verify both active readers return true. They reject pre-install release evidence, mismatched global releases and stale evidence epochs. Do not force a winner or a trained model.
6. Verify actual scheduled training receipts, rotating coverage, fresh account rollups, v6 decision/application receipts and learning health. Separate installation, activation, ordinary customer activity and measured improvement.

## Rollback

Disable the new scopes independently with `icash_activate_cash_question_learning(owner, release_sha, false)` and `icash_activate_seller_contact_learning(owner, release_sha, false)`; retain the factual interpretation of sent messages. The original ranker settings can disable model use. Keep all source evidence, learned decisions and costs. Restore SQL through a reviewed forward migration if necessary; never erase samples, rerun paid outreach or manufacture outcomes.

## Validation status

The new actual-SQL suites, affected evidence-policy/ranker suites, TypeScript and production webpack build passed locally. Native PostgreSQL verified 24 competing training claims, full bounded rotation, late disable, rollback, concurrent label preservation, exactly-once text assignment and serialized disable. The combined native text fixture installs the complete cost and parser prerequisites before the text migration. Final integrated SQL tests cover both gates' same-release reactivation and idempotent activation. A synthetic 1,000-property call refresh took 4.03 seconds in local PGlite; this is not a production latency promise.

The standard Turbopack build could not resolve this isolated checkout's external dependency symlink; the webpack production build and all build pre/postchecks passed. Canonical CI remains required for the actual release tree. The broader local suite and release receipts are tracked separately. Offline synthetic outcomes test the machinery; they do not establish real-world lift, lower customer cost or signed deals. No production activation is claimed by this implementation record.

All five reviewed database prerequisites were installed on November 14, 2026, in the order above. Repository migration filenames match their actual database migration receipts. At 18:29:56 UTC, both new allocation gates were false, the ranker had no active model, and learning health was `ok` with 672 accounts, zero failed/stale accounts and no refresh or conversion errors. Installation is not activation or evidence of improved conversion.
