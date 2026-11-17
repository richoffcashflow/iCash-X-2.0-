# Bounded deferred text batches

The once-per-minute maintenance pass previously stopped after one accepted original text. That imposed a theoretical 60-send/hour recovery ceiling across the pool even when independent numbers and customers had capacity.

`retryVolumeDeferredText` now processes at most four distinct selected originals per pass. It advances only after an original's accepted provider receipt is saved and reread successfully, or after one of the existing verified pre-send holds. An unknown claim, provider outcome, receipt outcome, configuration failure or repeated original stops the pass. This is a maximum of four attempts, not a promise of four delivered texts; ordinary sender pacing, current funding, contact controls and exact one-use claims still decide every dispatch.

The pass starts no new selection or dispatch once twenty seconds have elapsed. An already-started original finishes its bounded provider/receipt path; it is never abandoned through a timeout race or resubmitted. Slow requests therefore reduce batch size instead of multiplying four long transport waits. Internal results include checked and accepted counts; accepted still does not mean delivered.

No daily or hourly sender limit, three-minute cold-message spacing, recipient rule, saved sender, existing draft, charge, source binding or unknown-send hold changes. The separate deferred-turn fairness repair remains independent.

## Verify and release

Run `node --experimental-strip-types tests/deferred-text-recovery.test.mjs`, plus the existing receipt-recovery and text-claim refusal suites. Fictional fixtures exercise the original dispatch function, all claim kinds, four-message bound, duplicate original, pre-send holds, provider/receipt uncertainty after prior successes and start-budget expiry before/after a receipt. They make no external requests.

This application-only change needs the ordinary exact-release checks and deployment. There is no activation flag, backfill, historical ticket replay or provider limit adjustment. Observe ordinary maintenance accepted counts and original message receipts after release; the theoretical ceiling rises to 240 attempts/hour only when the real queue, time budget and unchanged per-number gates allow it.
