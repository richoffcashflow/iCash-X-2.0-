# Buyer intake, next actions and outcome evidence

The November 9 aimbot audit identified buyer intake, routine request execution and outcome receipts as the first release package. This change connects those existing workflows and repairs the package link on the buyer next-step page.

## Behavior

- Property packages and buyer next-step pages link to the existing free buyer enrollment. Buyers verify their email and explicitly save ZIP codes, budget, property type, current capacity and contact preferences. Existing 30-day expiry, suppression and email limits remain. This release does not enroll anyone automatically or equate preferences with verified funds or signing authority.
- The next-step page accepts `propertymsgs.com` package links and the two supported historical hosts. It rejects lookalike hosts, extra URL parameters and credentials; tokens are not replaced. Enrollment opens separately without leaking the private journey URL in the referrer.
- Fresh, narrowly recognized requests for details, photos or a package receive the current purchase-bound package. Requests to update buying criteria lead to enrollment. Requests for the next step return only the same thread's existing, current buyer journey. Mixed requests and unresolved exceptions remain in the existing review path. Neither link generation nor the classifier advances signing, promises access, creates an assignment or verifies payment.
- These replies use the existing incoming-source job, one outgoing request, single-segment limits, final contact/spending/STOP/Pause checks and original delivery-receipt reconciliation. Historical sources cannot enter the new path. No outbound buyer calls are enabled.
- New buyer discovery retains each contact's match confidence, phone type and DNC state, plus per-email verification status. The existing address-only email list remains compatible. Zero stays zero; unknown, malformed and future unsupported values stay null. Source and observation time are saved per profile because page receipts omit candidate records. The observation time is when iCash received the response, not a claim about the provider's last verification. No extra provider request, purchase, rank promotion or contact permission is introduced.
- The authenticated outcome report now separates buyer requests/details, verified assignment signatures, exact cleared-deposit receipts, title opening, title-reported deposit, scheduled closing, completed closing, title-reported disbursement and owner-confirmed proceeds. It binds deposits to the verified envelope, hash and amount; proceeds to the matching title update and closed deal. Invalid dates, mismatched identities, partial reads and unknown evidence do not become success. Totals remain independent observations, not conversion-rate or profitability claims. No raw buyer identity, capability, bank data or receipt references leave the report.

## Release prerequisites

1. Run the targeted fixture suites, TypeScript and the normal Reliability checks. All tests are offline. The SQL integration exercises actual queue, final-claim and receipt functions; no lock order or admission policy is replaced.
2. Install `20261109203059_buyer_request_actions.sql` with `buyer_actions_enabled=false`. The migration is additive and keeps the existing factual-reply implementation as its fallback.
3. Release the exact checked application and worker commit through the normal automatic-release queue. Verify production and worker identity before activation.
4. Enable `buyer_actions_enabled` and set `buyer_actions_enabled_at` to the activation timestamp in the private progress settings. Never backdate it to process old messages. Read back the function grants, flag, timestamp and migration receipt. Do not replay customer conversations or run paid demonstrations.

Rollback: set `buyer_actions_enabled=false`; leave original messages, receipts, tokens and observed outcomes intact. Older web/worker versions remain compatible with the extra profile metadata and inactive database wrapper.

## What this release does not establish

Real buyer enrollment, qualification, funded deposits and closings must arrive from normal production activity. This release does not establish a qualified learned model, improved closing rate, best-in-market data or a new sourcing winner. Broader geographic/investor discovery, tested contact ranking, changed-price negotiation and matched-source cost/yield comparisons remain separate work from this release. Existing published terms and explicit buyer holds remain in force.
