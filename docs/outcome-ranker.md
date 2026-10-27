# Property outcome learning

The outcome ranker adds a small CPU-only logistic model to the existing opportunity score. It reads saved DealMachine property measurements and original outcome receipts. It makes no provider requests, buys no additional data and requires no Python service, GPU or desktop application. Existing shared strategy learning continues independently.

## Evidence and targets

The private sample table stores six normalized property measurements (estimated value, equity percentage, repair estimate, living area, year built and estimated loan balance), each with a missing-value indicator. It stores no names, phone numbers, email addresses, conversation text or protected demographic features. Capture is restricted to financially eligible outbound discovery properties. Inbound and practice records are excluded.

A screening-completion trigger captures the vector once. Historical collection uses the saved pre-outreach property snapshot; it cannot invent a prospective baseline or model assignment. A property is deduplicated across accounts before fitting or validation. If an outcome predates the property snapshot, the example cannot train the model. Already-contracted properties are excluded from acquisition labels.

Actual provider-dispatched seller calls or accepted/delivered seller texts establish exposure. A queued attempt does not. Selling interest requires the existing confirmed call result or the existing exact seller-interest SMS receipt helper; an ownership reply alone is not interest. Contracts require the shared provider/envelope/terms/recipient signature verifier. Closings also require the existing verified title evidence. All labels, including known positives, wait for complete 72-hour interest, 30-day contract or 60-day closing windows. Uncontacted and immature records remain unknown. A negative label means no verified success in that window, not a confirmed refusal.

These are attributed property outcomes, not all platform contracts. Contracts outside the eligible outreach population are retained in their original records and never retroactively assigned to this experiment.

## Fitting and ranking

The existing bounded account-learning queue collects at most 200 historical samples and refreshes at most 200 labels per account invocation. `/api/internal/learning` runs hourly at minute 17, with the existing CRON_SECRET authentication, a three-minute database lease and a 45-second application deadline. It exports at most 5,000 examples and 200 per account, selected deterministically across history. Stale label refreshes are excluded. Twelve coefficients train for 120 iterations in TypeScript; no model training happens during outreach dispatch.

The trainer tries closing, contract and then interest targets. For each target it uses a later holdout, unique properties and a gap equal to the outcome window between training exposure and holdout exposure. Only baseline scores recorded before outreach qualify for the comparison set. At least 200 training examples, 100 validation examples, 20 training positives, 10 validation positives, enough negatives and three accounts in each split are required. A supported deal-level target that fails validation does not fall back to an easier proxy.

Qualification requires at least 5% lower Brier error than the training base rate, AUROC of at least 0.60 and at least 0.03 AUROC improvement over saved existing scores. These are fixed predictive gates, not evidence of causal business improvement. The owner panel says so explicitly.

A qualifying model scores newly captured properties once. A stable hash assigns roughly 20% of accounts to the existing ranking as a comparison group. For the remaining accounts, the existing score receives 85% weight and the predicted probability 15%. Financial eligibility, demand evidence, account controls, recipient permissions/hours, provider capacity and original financial admission are still authoritative. A missing, disabled, superseded or seven-day-old model restores the current existing score. Historical conversations and assignments never rotate.

The owner learning report exposes aggregate sample counts, mature verified outcomes, last training status and comparison-cohort totals. No raw training records are returned. Predictive accuracy does not establish cost per deal, causal lift or profit; complete settled acquisition costs and prospective contract/closing outcomes are needed to assess those. The model does not alter prices, limits or wallet rules.

## Release and operations

1. Run the three `outcome-ranker` test suites and the normal production reliability checks. All fixtures are synthetic and offline.
2. Apply `20261027034644_outcome_ranker.sql` before deploying the matching application. It is backward compatible and starts with model use and training disabled. Feature capture and the existing account refresh begin collecting evidence.
3. Release through the existing exact-main-SHA Reliability checks and Vercel/Railway gates. Verify both terminal deployment states.
4. Enable the private singleton only after the authenticated learning route is live: `update icash_ranker_private.settings set enabled=true where id=1;`. The hourly job records `collecting` when evidence is insufficient. Never force a qualified model or synthesize positive business outcomes.
5. Verify an actual training receipt and owner report. Watch account refresh failures and query time. A training failure leaves ranking available and a lease expires without provider replay.

For an immediate rollback of model influence and training, set `enabled=false` on the same singleton. Keep original samples and receipts for review. No provider configuration or customer reload is required.

Tests cover the real migration in isolated PostgreSQL, receipt-bound exposure, maturity, invalid data, private grants, overlapping leases, tenancy, comparison accounts, score limits, expiry, chronological leakage, duplicate properties, failed prediction gates and endpoint authentication. A local synthetic benchmark measures CPU work only; it does not measure live conversions.
